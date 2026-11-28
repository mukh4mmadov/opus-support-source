export type Role = "student" | "support" | "manager";

export interface NewUser {
  role: Role;
  first_name: string;
  last_name: string;
  birth_year?: number | null;
  bio?: string;
}

export interface Credentials {
  id: string;
  login: string;
  password: string;
  first_name: string;
  last_name: string;
  existing?: boolean;
  archived?: boolean;
}

export interface Person {
  id: string;
  login: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
}

export interface UserStore {
  loginExists(login: string): Promise<boolean>;
  findPeople(role: Role, birthYear: number | null): Promise<Person[]>;
  createUser(
    email: string,
    password: string,
    profile: NewUser & { login: string },
  ): Promise<string>;
  setPassword(userId: string, password: string): Promise<void>;
  loginOf(userId: string): Promise<string | null>;
  roleOf(userId: string): Promise<string | null>;
  isActive(userId: string): Promise<boolean>;
  changeLogin(userId: string, login: string): Promise<void>;
  sessionToken(userId: string): Promise<string>;
  releaseUser(userId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  savePasswordCopy(userId: string, ciphertext: string): Promise<void>;
  readPasswordCopy(userId: string): Promise<string | null>;
  markPasswordChanged(userId: string): Promise<void>;
  mustChangePassword(userId: string): Promise<boolean>;
  requirePasswordChange(userId: string): Promise<void>;
  audit(
    action: string,
    entityId: string,
    details: Record<string, unknown>,
  ): Promise<void>;
}

export const authEmail = (login: string) => `${login}@opus.internal`;

const clean = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export function baseLogin(
  first: string,
  last: string,
  birthYear?: number | null,
) {
  const name = [clean(first), clean(last)].filter(Boolean).join(".") || "user";
  const year = birthYear ? String(birthYear).slice(-2) : "";
  return `${name}${year}`;
}

async function uniqueLogin(store: UserStore, base: string) {
  if (!(await store.loginExists(base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!(await store.loginExists(candidate))) return candidate;
  }
  throw new Error("LOGIN_UNAVAILABLE");
}

const PASSWORD_ALPHABET =
  "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function makePassword(length = 10) {
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  let password = "";
  while (password.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && password.length < length) {
        password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
      }
    }
  }
  return password;
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

const importKey = (keyBase64: string) =>
  crypto.subtle.importKey("raw", fromBase64(keyBase64), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);

export async function encryptPassword(password: string, keyBase64: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importKey(keyBase64),
    new TextEncoder().encode(password),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
}

export async function decryptPassword(ciphertext: string, keyBase64: string) {
  const [iv, sealed] = ciphertext.split(".");
  const opened = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    await importKey(keyBase64),
    fromBase64(sealed),
  );
  return new TextDecoder().decode(opened);
}

function validate(user: NewUser) {
  const first = user.first_name?.trim();
  const last = user.last_name?.trim();
  if (!first || !last) throw new Error("NAME_REQUIRED");
  if (
    user.role !== "student" &&
    user.role !== "support" &&
    user.role !== "manager"
  )
    throw new Error("ROLE_INVALID");
  const year = user.birth_year ?? null;
  const thisYear = new Date().getFullYear();
  if (
    year !== null &&
    (!Number.isInteger(year) || year < 1930 || year > thisYear)
  ) {
    throw new Error("BIRTH_YEAR_INVALID");
  }
  return {
    ...user,
    first_name: first,
    last_name: last,
    birth_year: year,
    bio: user.bio ?? "",
  };
}

const sameName = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['`´‘’ʻʼ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

async function findSame(
  store: UserStore,
  keyBase64: string,
  user: ReturnType<typeof validate>,
  callerRole: string,
) {
  const same = (await store.findPeople(user.role, user.birth_year)).find(
    (person) =>
      sameName(person.first_name) === sameName(user.first_name) &&
      sameName(person.last_name) === sameName(user.last_name),
  );
  if (!same) return null;
  const ciphertext =
    callerRole === "manager" && !(await store.mustChangePassword(same.id))
      ? null
      : await store.readPasswordCopy(same.id);
  await store.audit("user.view_password", same.id, { login: same.login });
  return {
    id: same.id,
    login: same.login,
    password: ciphertext ? await decryptPassword(ciphertext, keyBase64) : "",
    first_name: same.first_name,
    last_name: same.last_name,
    existing: true,
    archived: !same.is_active,
  };
}

export function firstPassword(login: string) {
  return login.length >= 8 ? login : login + "0".repeat(8 - login.length);
}

export async function createAccount(
  store: UserStore,
  keyBase64: string,
  input: NewUser,
  callerRole = "admin",
): Promise<Credentials> {
  const user = validate(
    callerRole === "manager" && input.role === "support"
      ? { ...input, bio: "" }
      : input,
  );
  const existing = await findSame(store, keyBase64, user, callerRole);
  if (existing) return existing;
  const login = await uniqueLogin(
    store,
    baseLogin(user.first_name, user.last_name, user.birth_year),
  );
  const manager = user.role === "manager";
  const password = manager ? makePassword() : firstPassword(login);
  const id = await store.createUser(authEmail(login), password, {
    ...user,
    login,
  });
  await store.savePasswordCopy(id, await encryptPassword(password, keyBase64));
  if (!manager) await store.requirePasswordChange(id);
  await store.audit("user.create", id, {
    name: `${user.first_name} ${user.last_name}`,
    role: user.role,
    login,
  });
  return {
    id,
    login,
    password,
    first_name: user.first_name,
    last_name: user.last_name,
  };
}

export type AdminAction =
  | { action: "create"; user: NewUser }
  | { action: "import"; users: NewUser[] }
  | { action: "reset_password"; user_id: string }
  | { action: "view_password"; user_id: string }
  | { action: "change_login"; user_id: string; login: string }
  | { action: "impersonate"; user_id: string }
  | { action: "delete"; user_id: string };

export async function handleAdminAction(
  store: UserStore,
  keyBase64: string,
  request: AdminAction,
  callerRole = "admin",
) {
  if (callerRole !== "admin") {
    if (request.action === "create" && request.user.role === "manager")
      throw new Error("FORBIDDEN");
    if (
      request.action === "import" &&
      request.users.some((user) => user.role === "manager")
    ) {
      throw new Error("FORBIDDEN");
    }
    if (request.action === "view_password") {
      const target = await store.roleOf(request.user_id);
      if (target !== "student" && target !== "support")
        throw new Error("FORBIDDEN");
      if (!(await store.mustChangePassword(request.user_id)))
        throw new Error("PASSWORD_CHANGED_BY_USER");
    } else if (request.action !== "create" && request.action !== "import") {
      throw new Error("FORBIDDEN");
    }
  }
  switch (request.action) {
    case "create":
      return {
        credentials: await createAccount(
          store,
          keyBase64,
          request.user,
          callerRole,
        ),
      };
    case "import": {
      const created: Credentials[] = [];
      const failed: { row: number; error: string }[] = [];
      for (const [index, user] of request.users.entries()) {
        try {
          created.push(await createAccount(store, keyBase64, user, callerRole));
        } catch (error) {
          failed.push({ row: index + 1, error: (error as Error).message });
        }
      }
      return { created, failed };
    }
    case "reset_password": {
      const login = await store.loginOf(request.user_id);
      if (!login) throw new Error("USER_NOT_FOUND");
      const role = await store.roleOf(request.user_id);
      const fresh = role === "student" || role === "support";
      const password = fresh ? firstPassword(login) : makePassword();
      await store.setPassword(request.user_id, password);
      if (role !== "admin") {
        await store.savePasswordCopy(
          request.user_id,
          await encryptPassword(password, keyBase64),
        );
      }
      if (fresh) await store.requirePasswordChange(request.user_id);
      await store.audit("user.reset_password", request.user_id, { login });
      return { login, password };
    }
    case "view_password": {
      const login = await store.loginOf(request.user_id);
      if (!login) throw new Error("USER_NOT_FOUND");
      const ciphertext = await store.readPasswordCopy(request.user_id);
      if (!ciphertext) throw new Error("PASSWORD_NOT_STORED");
      await store.audit("user.view_password", request.user_id, { login });
      return { login, password: await decryptPassword(ciphertext, keyBase64) };
    }
    case "change_login": {
      const current = await store.loginOf(request.user_id);
      if (!current) throw new Error("USER_NOT_FOUND");
      if ((await store.roleOf(request.user_id)) === "admin")
        throw new Error("FORBIDDEN");
      const login = String(request.login ?? "")
        .trim()
        .toLowerCase();
      if (!/^[a-z0-9][a-z0-9.-]{2,40}$/.test(login))
        throw new Error("LOGIN_INVALID");
      if (login !== current && (await store.loginExists(login)))
        throw new Error("LOGIN_TAKEN");
      await store.changeLogin(request.user_id, login);
      await store.audit("user.change_login", request.user_id, {
        from: current,
        to: login,
      });
      return { login };
    }
    case "impersonate": {
      const login = await store.loginOf(request.user_id);
      if (!login) throw new Error("USER_NOT_FOUND");
      if ((await store.roleOf(request.user_id)) === "admin")
        throw new Error("FORBIDDEN");
      if (!(await store.isActive(request.user_id)))
        throw new Error("USER_ARCHIVED");
      const token = await store.sessionToken(request.user_id);
      await store.audit("user.impersonate", request.user_id, { login });
      return { token };
    }
    case "delete": {
      const login = await store.loginOf(request.user_id);
      if (!login) throw new Error("USER_NOT_FOUND");
      await store.releaseUser(request.user_id);
      await store.audit("user.delete", request.user_id, { login });
      await store.deleteUser(request.user_id);
      return { ok: true };
    }
    default:
      throw new Error("ACTION_INVALID");
  }
}

export async function changeOwnPassword(
  store: UserStore,
  keyBase64: string,
  userId: string,
  password: string,
) {
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 72
  ) {
    throw new Error("PASSWORD_INVALID");
  }
  if ((await store.roleOf(userId)) === "manager") throw new Error("FORBIDDEN");
  const login = await store.loginOf(userId);
  if (login && password.toLowerCase() === login.toLowerCase())
    throw new Error("PASSWORD_SAME_AS_LOGIN");
  await store.setPassword(userId, password);
  if ((await store.roleOf(userId)) === "admin") return { ok: true };
  await store.savePasswordCopy(
    userId,
    await encryptPassword(password, keyBase64),
  );
  await store.markPasswordChanged(userId);
  return { ok: true };
}
