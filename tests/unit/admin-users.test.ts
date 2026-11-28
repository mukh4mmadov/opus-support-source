import { describe, expect, it } from "vitest";
import {
  baseLogin,
  changeOwnPassword,
  createAccount,
  decryptPassword,
  encryptPassword,
  firstPassword,
  handleAdminAction,
  makePassword,
  type Credentials,
  type NewUser,
  type UserStore,
} from "../../supabase/functions/_shared/admin-users.ts";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

function memoryStore() {
  const users = new Map<
    string,
    { login: string; password: string; role?: string }
  >();
  const profiles = new Map<string, NewUser & { login: string }>();
  const copies = new Map<string, string>();
  const archived = new Set<string>();
  const changed: string[] = [];
  const log: string[] = [];
  const released: string[] = [];
  const flagged = new Set<string>();
  const store: UserStore = {
    loginExists: async (login) =>
      [...users.values()].some((user) => user.login === login),
    findPeople: async (role, birthYear) =>
      [...profiles.entries()]
        .filter(
          ([id, person]) =>
            users.has(id) &&
            person.role === role &&
            (person.birth_year ?? null) === birthYear,
        )
        .map(([id, person]) => ({
          id,
          login: users.get(id)!.login,
          first_name: person.first_name,
          last_name: person.last_name,
          is_active: !archived.has(id),
        })),
    createUser: async (_email, password, profile) => {
      const id = String(users.size + 1);
      users.set(id, { login: profile.login, password });
      profiles.set(id, profile);
      return id;
    },
    setPassword: async (id, password) =>
      void (users.get(id)!.password = password),
    loginOf: async (id) => users.get(id)?.login ?? null,
    roleOf: async (id) => users.get(id)?.role ?? "student",
    isActive: async (id) => !archived.has(id),
    changeLogin: async (id, login) => void (users.get(id)!.login = login),
    sessionToken: async (id) => `token-${id}`,
    savePasswordCopy: async (id, ciphertext) => void copies.set(id, ciphertext),
    readPasswordCopy: async (id) => copies.get(id) ?? null,
    markPasswordChanged: async (id) => {
      changed.push(id);
      flagged.delete(id);
    },
    requirePasswordChange: async (id) => void flagged.add(id),
    mustChangePassword: async (id) => flagged.has(id),
    releaseUser: async (id) => void released.push(id),
    deleteUser: async (id) => void users.delete(id),
    audit: async (action) => void log.push(action),
  };
  return {
    store,
    users,
    profiles,
    released,
    copies,
    changed,
    log,
    archived,
    flagged,
  };
}

const student: NewUser = {
  role: "student",
  first_name: "Aziza",
  last_name: "Karimova",
  birth_year: 2008,
};

describe("logins", () => {
  it("builds a login from the name and birth year", () => {
    expect(baseLogin("Aziza", "Karimova", 2008)).toBe("aziza.karimova08");
  });

  it("drops Uzbek apostrophes", () => {
    expect(baseLogin("G'ulom", "To'xtayev", 2007)).toBe("gulom.toxtayev07");
    expect(baseLogin("Oʻgʻiloy", "Ergasheva", null)).toBe("ogiloy.ergasheva");
  });

  it("keeps working for names with no Latin letters", () => {
    expect(baseLogin("Азиза", "Каримова", 2008)).toBe("user08");
  });

  it("never reuses a login", async () => {
    const { store } = memoryStore();
    const first = await createAccount(store, KEY, student);
    const second = await createAccount(store, KEY, {
      ...student,
      role: "support",
    });
    expect([first.login, second.login]).toEqual([
      "aziza.karimova08",
      "aziza.karimova08-2",
    ]);
  });
});

describe("the same person twice", () => {
  it("gives the account they already have instead of a second one", async () => {
    const { store, users, log } = memoryStore();
    const first = await createAccount(store, KEY, student);
    const again = await createAccount(store, KEY, {
      ...student,
      first_name: " aziza ",
      last_name: "KARIMOVA",
    });
    expect(again).toMatchObject({
      id: first.id,
      login: first.login,
      password: first.password,
      existing: true,
      archived: false,
    });
    expect(users.size).toBe(1);
    expect(log).toContain("user.view_password");

    expect(
      (await createAccount(store, KEY, { ...student, birth_year: 2009 }))
        .existing,
    ).toBeUndefined();
    expect(
      (await createAccount(store, KEY, { ...student, role: "support" }))
        .existing,
    ).toBeUndefined();
  });

  it("sees through different apostrophes, and says when the person is in the archive", async () => {
    const { store, archived } = memoryStore();
    const first = await createAccount(store, KEY, {
      ...student,
      first_name: "G'ulom",
    });
    archived.add(first.id);
    const again = await createAccount(store, KEY, {
      ...student,
      first_name: "Gʻulom",
    });
    expect(again).toMatchObject({
      id: first.id,
      existing: true,
      archived: true,
    });
  });

  it("marks people in an import who already have an account, even twice in one file", async () => {
    const { store, users } = memoryStore();
    await createAccount(store, KEY, student);
    const bobur = { ...student, first_name: "Bobur" };
    const result = (await handleAdminAction(store, KEY, {
      action: "import",
      users: [student, bobur, bobur],
    })) as {
      created: Credentials[];
    };
    expect(result.created.map((item) => item.existing ?? false)).toEqual([
      true,
      false,
      true,
    ]);
    expect(users.size).toBe(2);
  });
});

describe("the first password", () => {
  it("is the login, and has to be replaced at the first sign-in", async () => {
    const { store, flagged, users } = memoryStore();
    const made = await createAccount(store, KEY, student);
    expect(made.password).toBe("aziza.karimova08");
    expect(users.get(made.id)!.password).toBe("aziza.karimova08");
    expect(flagged.has(made.id)).toBe(true);
    await expect(
      changeOwnPassword(store, KEY, made.id, "Aziza.Karimova08"),
    ).rejects.toThrow("PASSWORD_SAME_AS_LOGIN");
    await changeOwnPassword(store, KEY, made.id, "my-own-pass");
    expect(users.get(made.id)!.password).toBe("my-own-pass");
  });

  it("pads a short login to 8 characters", () => {
    expect(firstPassword("ab.c08")).toBe("ab.c0800");
    expect(firstPassword("aziza.karimova08")).toBe("aziza.karimova08");
  });

  it("is the login again after a reset, but never for the admin", async () => {
    const { store, flagged, users } = memoryStore();
    const { id } = await createAccount(store, KEY, student);
    flagged.clear();
    const reset = (await handleAdminAction(store, KEY, {
      action: "reset_password",
      user_id: id,
    })) as { password: string };
    expect(reset.password).toBe("aziza.karimova08");
    expect(flagged.has(id)).toBe(true);
    users.set("developer", { login: "developer", password: "x", role: "admin" });
    const own = (await handleAdminAction(store, KEY, {
      action: "reset_password",
      user_id: "developer",
    })) as { password: string };
    expect(own.password).not.toBe("developer00");
    expect(flagged.has("developer")).toBe(false);
  });
});

describe("second-level admin", () => {
  it("cannot set a support teacher's About text when creating them", async () => {
    const { store, profiles } = memoryStore();
    const made = (await handleAdminAction(
      store,
      KEY,
      {
        action: "create",
        user: {
          role: "support",
          first_name: "Teacher",
          last_name: "One",
          bio: "manager supplied text",
        },
      },
      "manager",
    )) as { credentials: Credentials };
    expect(profiles.get(made.credentials.id)?.bio).toBe("");
  });

  it("adds people and reads a password only while it is still the first one", async () => {
    const { store, users } = memoryStore();
    const made = (await handleAdminAction(
      store,
      KEY,
      { action: "create", user: student },
      "manager",
    )) as {
      credentials: Credentials;
    };
    const id = made.credentials.id;
    const shown = (await handleAdminAction(
      store,
      KEY,
      { action: "view_password", user_id: id },
      "manager",
    )) as {
      password: string;
    };
    expect(shown.password).toBe("aziza.karimova08");
    await changeOwnPassword(store, KEY, id, "my-own-pass");
    await expect(
      handleAdminAction(
        store,
        KEY,
        { action: "view_password", user_id: id },
        "manager",
      ),
    ).rejects.toThrow("PASSWORD_CHANGED_BY_USER");
    await handleAdminAction(store, KEY, {
      action: "view_password",
      user_id: id,
    });
    expect(users.has(id)).toBe(true);
  });

  it("does not reveal a changed password through duplicate account lookup", async () => {
    const { store } = memoryStore();
    const created = (await handleAdminAction(
      store,
      KEY,
      { action: "create", user: student },
      "manager",
    )) as { credentials: Credentials };
    await changeOwnPassword(
      store,
      KEY,
      created.credentials.id,
      "chosen-password",
    );
    const duplicate = (await handleAdminAction(
      store,
      KEY,
      { action: "create", user: student },
      "manager",
    )) as { credentials: Credentials };
    expect(duplicate.credentials).toMatchObject({
      existing: true,
      password: "",
    });
  });

  it("cannot reset, rename, sign in as, delete or make another reception", async () => {
    const { store } = memoryStore();
    const { id } = await createAccount(store, KEY, student);
    for (const request of [
      { action: "reset_password", user_id: id },
      { action: "change_login", user_id: id, login: "someone.else" },
      { action: "impersonate", user_id: id },
      { action: "delete", user_id: id },
      { action: "create", user: { ...student, role: "manager" } },
    ] as const) {
      await expect(
        handleAdminAction(store, KEY, request, "manager"),
      ).rejects.toThrow("FORBIDDEN");
    }
  });

  it("gets a strong password from the developer, and cannot change it", async () => {
    const { store, users, flagged } = memoryStore();
    const desk = await createAccount(store, KEY, {
      role: "manager",
      first_name: "Second",
      last_name: "Admin",
    });
    expect(desk.password).not.toBe(desk.login);
    expect(desk.password).toHaveLength(10);
    expect(flagged.has(desk.id)).toBe(false);
    users.get(desk.id)!.role = "manager";
    await expect(
      changeOwnPassword(store, KEY, desk.id, "my-own-pass"),
    ).rejects.toThrow("FORBIDDEN");
    const reset = (await handleAdminAction(store, KEY, {
      action: "reset_password",
      user_id: desk.id,
    })) as { password: string };
    expect(reset.password).not.toBe(desk.login);
    expect(flagged.has(desk.id)).toBe(false);
  });
});

describe("passwords", () => {
  it("avoids characters that are easy to misread", () => {
    const passwords = Array.from({ length: 200 }, () => makePassword()).join(
      "",
    );
    expect(passwords).not.toMatch(/[01OIl]/);
  });

  it("is long enough and different every time", () => {
    const passwords = new Set(
      Array.from({ length: 200 }, () => makePassword()),
    );
    expect(passwords.size).toBe(200);
    for (const password of passwords) expect(password).toHaveLength(10);
  });
});

describe("password copies", () => {
  it("stores no readable text", async () => {
    const { store, copies } = memoryStore();
    const { id, password } = await createAccount(store, KEY, student);
    expect(copies.get(id)).not.toContain(password);
    expect(await decryptPassword(copies.get(id)!, KEY)).toBe(password);
  });

  it("cannot be opened with another key", async () => {
    const sealed = await encryptPassword("secret-password", KEY);
    const wrong = btoa(String.fromCharCode(...new Uint8Array(32).fill(3)));
    await expect(decryptPassword(sealed, wrong)).rejects.toThrow();
  });

  it("lets the admin read the current password, and logs it", async () => {
    const { store, log } = memoryStore();
    const { id, password } = await createAccount(store, KEY, student);
    const shown = (await handleAdminAction(store, KEY, {
      action: "view_password",
      user_id: id,
    })) as { password: string };
    expect(shown.password).toBe(password);
    expect(log).toContain("user.view_password");
  });

  it("stays current when the user changes it", async () => {
    const { store, changed } = memoryStore();
    const { id } = await createAccount(store, KEY, student);
    await changeOwnPassword(store, KEY, id, "my-new-password");
    const shown = (await handleAdminAction(store, KEY, {
      action: "view_password",
      user_id: id,
    })) as { password: string };
    expect(shown.password).toBe("my-new-password");
    expect(changed).toEqual([id]);
  });

  it("never keeps a copy of the admin password", async () => {
    const { store, users, copies, changed } = memoryStore();
    users.set("developer", { login: "developer", password: "x", role: "admin" });
    await changeOwnPassword(store, KEY, "developer", "a-very-long-password");
    await handleAdminAction(store, KEY, {
      action: "reset_password",
      user_id: "developer",
    });
    expect(copies.has("developer")).toBe(false);
    expect(changed).toEqual([]);
  });

  it("refuses a short password", async () => {
    const { store } = memoryStore();
    await expect(changeOwnPassword(store, KEY, "1", "short")).rejects.toThrow(
      "PASSWORD_INVALID",
    );
  });
});

describe("admin powers", () => {
  it("changes a login and refuses a taken or bad one", async () => {
    const { store, users } = memoryStore();
    const { id } = await createAccount(store, KEY, student);
    await createAccount(store, KEY, { ...student, first_name: "Bobur" });
    const change = (login: string) =>
      handleAdminAction(store, KEY, {
        action: "change_login",
        user_id: id,
        login,
      });
    await expect(change("bobur.karimova08")).rejects.toThrow("LOGIN_TAKEN");
    await expect(change("a b")).rejects.toThrow("LOGIN_INVALID");
    await change("Aziza.New");
    expect(users.get(id)!.login).toBe("aziza.new");
  });

  it("signs in as a person, logs it, and never as another admin or an archived person", async () => {
    const { store, users, archived, log } = memoryStore();
    const { id } = await createAccount(store, KEY, student);
    const signIn = (user: string) =>
      handleAdminAction(store, KEY, { action: "impersonate", user_id: user });
    expect(await signIn(id)).toEqual({ token: `token-${id}` });
    expect(log).toContain("user.impersonate");

    users.set("developer", { login: "developer", password: "x", role: "admin" });
    await expect(signIn("developer")).rejects.toThrow("FORBIDDEN");
    archived.add(id);
    await expect(signIn(id)).rejects.toThrow("USER_ARCHIVED");
  });
});

describe("account actions", () => {
  it("refuses a missing name and an impossible birth year", async () => {
    const { store } = memoryStore();
    await expect(
      createAccount(store, KEY, { ...student, first_name: " " }),
    ).rejects.toThrow("NAME_REQUIRED");
    await expect(
      createAccount(store, KEY, { ...student, birth_year: 1800 }),
    ).rejects.toThrow("BIRTH_YEAR_INVALID");
  });

  it("never creates an admin", async () => {
    const { store } = memoryStore();
    await expect(
      createAccount(store, KEY, { ...student, role: "admin" as never }),
    ).rejects.toThrow("ROLE_INVALID");
  });

  it("imports good rows and reports bad ones", async () => {
    const { store } = memoryStore();
    const result = (await handleAdminAction(store, KEY, {
      action: "import",
      users: [
        student,
        { ...student, last_name: "" },
        { ...student, first_name: "Bobur" },
      ],
    })) as { created: unknown[]; failed: { row: number }[] };
    expect(result.created).toHaveLength(2);
    expect(result.failed).toEqual([{ row: 2, error: "NAME_REQUIRED" }]);
  });

  it("replaces the password on reset", async () => {
    const { store, users } = memoryStore();
    const { id, login } = await createAccount(store, KEY, student);
    await changeOwnPassword(store, KEY, id, "forgotten-one");
    const result = (await handleAdminAction(store, KEY, {
      action: "reset_password",
      user_id: id,
    })) as { password: string };
    expect(result.password).toBe(login);
    expect(users.get(id)!.password).toBe(result.password);
  });

  it("releases lessons before deleting", async () => {
    const { store, users, released } = memoryStore();
    const { id } = await createAccount(store, KEY, student);
    await handleAdminAction(store, KEY, { action: "delete", user_id: id });
    expect(released).toEqual([id]);
    expect(users.has(id)).toBe(false);
  });
});
