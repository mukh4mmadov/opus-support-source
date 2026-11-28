import { createServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { callAs, createDb } from "./db.mjs";
import {
  authEmail,
  changeOwnPassword,
  encryptPassword,
  handleAdminAction,
} from "../supabase/functions/_shared/admin-users.ts";

const PORT = Number(process.env.PORT ?? 54321);
const inMemory = process.argv.includes("--memory");
const allowTimeTravel = inMemory;

const db = await createDb(inMemory ? undefined : ".local-db");

const PASSWORD_KEY = Buffer.alloc(32, 7).toString("base64");

const hashPassword = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
};

const checkPassword = (password, stored) => {
  const [salt, hash] = (stored ?? ":").split(":");
  if (!salt) return false;
  return timingSafeEqual(
    scryptSync(password, salt, 32),
    Buffer.from(hash, "hex"),
  );
};

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function session(user) {
  const expiresIn = 3600;
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({
    sub: user.id,
    email: user.email,
    role: "authenticated",
    exp,
  })}.bG9jYWw`;
  return {
    access_token: token,
    refresh_token: `refresh-${user.id}`,
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: exp,
    user: authUser(user),
  };
}

const authUser = (user) => ({
  id: user.id,
  aud: "authenticated",
  role: "authenticated",
  email: user.email,
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
});

function userIdFrom(req) {
  const token = req.headers.authorization?.replace("Bearer ", "").split(".");
  if (token?.length !== 3) return null;
  try {
    return (
      JSON.parse(Buffer.from(token[1], "base64url").toString()).sub ?? null
    );
  } catch {
    return null;
  }
}

const makeStore = (callerId) => ({
  async loginExists(login) {
    const { rows } = await db.query(
      "select 1 from public.profiles where login = $1",
      [login],
    );
    return rows.length > 0;
  },
  async findPeople(role, birthYear) {
    const { rows } = await db.query(
      `select id, login, first_name, last_name, is_active from public.profiles
       where role = $1 and birth_year is not distinct from $2::int`,
      [role, birthYear],
    );
    return rows;
  },
  async createUser(email, password, profile) {
    const { rows } = await db.query(
      "insert into auth.users (email, encrypted_password) values ($1, $2) returning id",
      [email, hashPassword(password)],
    );
    await db.query(
      `insert into public.profiles (id, role, login, first_name, last_name, birth_year, bio)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        rows[0].id,
        profile.role,
        profile.login,
        profile.first_name,
        profile.last_name,
        profile.birth_year,
        profile.bio,
      ],
    );
    return rows[0].id;
  },
  async setPassword(userId, password) {
    await db.query(
      "update auth.users set encrypted_password = $2 where id = $1",
      [userId, hashPassword(password)],
    );
  },
  async loginOf(userId) {
    const { rows } = await db.query(
      "select login from public.profiles where id = $1",
      [userId],
    );
    return rows[0]?.login ?? null;
  },
  async roleOf(userId) {
    const { rows } = await db.query(
      "select role from public.profiles where id = $1",
      [userId],
    );
    return rows[0]?.role ?? null;
  },
  async isActive(userId) {
    const { rows } = await db.query(
      "select is_active from public.profiles where id = $1",
      [userId],
    );
    return rows[0]?.is_active === true;
  },
  async changeLogin(userId, login) {
    await db.query("update auth.users set email = $2 where id = $1", [
      userId,
      authEmail(login),
    ]);
    await db.query("update public.profiles set login = $2 where id = $1", [
      userId,
      login,
    ]);
  },
  sessionToken: async (userId) => `local-${userId}`,
  async savePasswordCopy(userId, ciphertext) {
    await db.query(
      `insert into public.account_passwords (user_id, ciphertext) values ($1, $2)
       on conflict (user_id) do update set ciphertext = excluded.ciphertext, updated_at = now()`,
      [userId, ciphertext],
    );
  },
  async readPasswordCopy(userId) {
    const { rows } = await db.query(
      "select ciphertext from public.account_passwords where user_id = $1",
      [userId],
    );
    return rows[0]?.ciphertext ?? null;
  },
  async requirePasswordChange(userId) {
    await db.query(
      "update public.profiles set must_change_password = true where id = $1",
      [userId],
    );
  },
  async mustChangePassword(userId) {
    const { rows } = await db.query(
      "select must_change_password from public.profiles where id = $1",
      [userId],
    );
    return rows[0]?.must_change_password === true;
  },
  async markPasswordChanged(userId) {
    await db.query("select public.record_password_change($1)", [userId]);
  },
  releaseUser: (userId) =>
    callAs(db, callerId, "admin_release_user", { p_user: userId }),
  async deleteUser(userId) {
    await db.query("delete from auth.users where id = $1", [userId]);
  },
  async audit(action, entityId, details) {
    await db.query(
      `insert into public.audit_log (actor_id, action, entity, entity_id, details)
       values ($1, $2, 'user', $3, $4)`,
      [callerId, action, entityId, JSON.stringify(details)],
    );
  },
});

const JSON_ARGS = new Set(["p_value", "p_rows"]);

const encodeArgs = (args) =>
  Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      JSON_ARGS.has(key) ? JSON.stringify(value) : value,
    ]),
  );

async function seedAdmin() {
  const { rows } = await db.query(
    "select 1 from public.profiles where role = 'admin'",
  );
  if (rows.length > 0) return false;
  const store = makeStore(null);
  const id = await store.createUser(authEmail("admin"), "admin12345", {
    role: "admin",
    login: "admin",
    first_name: "OPUS",
    last_name: "Developer",
    birth_year: null,
    bio: "",
  });
  return id;
}

async function seedDemo() {
  const adminId = await seedAdmin();
  if (!adminId || inMemory) return;
  const store = makeStore(adminId);
  const addUser = async (role, first, last, password, bio = "") => {
    const id = await store.createUser(
      authEmail(`${first}`.toLowerCase()),
      password,
      {
        role,
        login: first.toLowerCase(),
        first_name: first,
        last_name: last,
        birth_year: 2008,
        bio,
      },
    );
    await store.savePasswordCopy(
      id,
      await encryptPassword(password, PASSWORD_KEY),
    );
    return id;
  };
  const supports = [
    ["Ozodbek", "Karimov", "IELTS 8.0. Speaking and writing practice."],
    ["Malika", "Rahimova", "Grammar and exam preparation."],
    ["Jasur", "Toshmatov", "Beginners and vocabulary."],
  ];
  for (const [first, last, bio] of supports) {
    const id = await addUser("support", first, last, "support123", bio);
    const rows = [1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      start_time: "14:00",
      end_time: "18:00",
    }));
    await callAs(db, adminId, "admin_set_schedule", {
      p_support: id,
      p_rows: JSON.stringify(rows),
    });
  }
  for (const [first, last] of [
    ["Aziza", "Karimova"],
    ["Bobur", "Aliyev"],
    ["Dilnoza", "Usmonova"],
  ]) {
    await addUser("student", first, last, "student123");
  }
  await seedHistory();
}

async function seedHistory() {
  const people = async (role) =>
    (
      await db.query(
        "select id from public.profiles where role = $1 order by first_name",
        [role],
      )
    ).rows;
  const students = await people("student");
  const teachers = await people("support");
  const topics = [
    "Present Perfect",
    "IELTS Writing Task 2",
    "Phrasal verbs",
    "Speaking Part 2",
    "Reading practice",
  ];
  const comments = [
    "Very clear explanation.",
    "Helped me a lot with writing.",
    "",
    "Good lesson.",
  ];
  let n = 0;
  for (let daysAgo = 26; daysAgo >= 1; daysAgo--) {
    for (let i = 0; i < 2 + (daysAgo % 4); i++) {
      n++;
      const status =
        n % 9 === 0 ? "no_show" : n % 13 === 0 ? "cancelled" : "attended";
      const { rows } = await db.query(
        `insert into public.bookings
           (student_id, support_id, lesson_date, starts_at, ends_at, topic, status)
         select $1, $2, x.d, y.s, y.s + interval '30 minutes', $3, $4
         from (select (now() at time zone 'Asia/Tashkent')::date - $5::int as d) x,
         lateral (select ((x.d + make_time(14 + $6::int, 0, 0))
           at time zone 'Asia/Tashkent') as s) y
         returning id, student_id, support_id`,
        [
          students[n % students.length].id,
          teachers[n % teachers.length].id,
          topics[n % topics.length],
          status,
          daysAgo,
          i,
        ],
      );
      if (status === "attended" && n % 4 === 0) {
        await db.query(
          `insert into public.reviews (booking_id, student_id, support_id, rating, comment)
           values ($1, $2, $3, $4, $5)`,
          [
            rows[0].id,
            rows[0].student_id,
            rows[0].support_id,
            4 + (n % 2),
            comments[n % comments.length],
          ],
        );
      }
    }
  }
}

await seedDemo();
setInterval(
  () => db.query("select public.run_maintenance()").catch(console.error),
  60_000,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "*",
};

function send(res, status, body) {
  res.writeHead(status, { ...cors, "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function handleToken(url, body, res) {
  const grant = url.searchParams.get("grant_type");
  let found;
  if (grant === "password") {
    const { rows } = await db.query(
      "select * from auth.users where email = $1",
      [body.email],
    );
    found = rows[0];
    if (!found || !checkPassword(body.password, found.encrypted_password)) {
      return send(res, 400, {
        error_code: "invalid_credentials",
        msg: "Invalid login credentials",
      });
    }
  } else {
    const id = body.refresh_token?.replace("refresh-", "");
    const { rows } = await db.query("select * from auth.users where id = $1", [
      id,
    ]);
    found = rows[0];
    if (!found)
      return send(res, 400, {
        error_code: "refresh_token_not_found",
        msg: "Invalid token",
      });
  }
  send(res, 200, session(found));
}

async function route(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  if (req.method === "OPTIONS") return send(res, 200);

  if (path === "/auth/v1/token")
    return handleToken(url, await readJson(req), res);
  if (path === "/auth/v1/logout") return send(res, 204);
  if (path === "/auth/v1/verify") {
    const { token_hash: token } = await readJson(req);
    const { rows } = await db.query("select * from auth.users where id = $1", [
      String(token).replace("local-", ""),
    ]);
    if (!rows[0]) return send(res, 400, { msg: "Invalid token" });
    return send(res, 200, session(rows[0]));
  }
  if (path === "/auth/v1/user") {
    const id = userIdFrom(req);
    const { rows } = await db.query("select * from auth.users where id = $1", [
      id,
    ]);
    if (!rows[0]) return send(res, 401, { msg: "Not signed in" });
    if (req.method === "PUT") {
      const body = await readJson(req);
      const me = await callAs(db, id, "get_me").catch(() => null);
      if (body.password && me?.role === "manager")
        return send(res, 403, { msg: "FORBIDDEN" });
      if (body.password) await makeStore(id).setPassword(id, body.password);
    }
    return send(res, 200, authUser(rows[0]));
  }

  const rpc = path.match(/^\/rest\/v1\/rpc\/(\w+)$/);
  if (rpc) {
    try {
      const args = encodeArgs(await readJson(req));
      return send(res, 200, await callAs(db, userIdFrom(req), rpc[1], args));
    } catch (error) {
      return send(res, 400, { message: error.message, code: error.code });
    }
  }

  if (path === "/functions/v1/admin-users") {
    const callerId = userIdFrom(req);
    const me = await callAs(db, callerId, "get_me").catch(() => null);
    if (me?.role !== "admin" && me?.role !== "manager")
      return send(res, 403, { error: "FORBIDDEN" });
    try {
      return send(
        res,
        200,
        await handleAdminAction(
          makeStore(callerId),
          PASSWORD_KEY,
          await readJson(req),
          me.role,
        ),
      );
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
  }

  if (path === "/functions/v1/account") {
    const callerId = userIdFrom(req);
    const me = await callAs(db, callerId, "get_me").catch(() => null);
    if (!me) return send(res, 403, { error: "FORBIDDEN" });
    try {
      const { password } = await readJson(req);
      return send(
        res,
        200,
        await changeOwnPassword(
          makeStore(callerId),
          PASSWORD_KEY,
          callerId,
          password,
        ),
      );
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
  }

  if (allowTimeTravel && path === "/__test/now") {
    const { iso } = await readJson(req);
    const value = iso
      ? `'${new Date(iso).toISOString()}'::timestamptz`
      : "now()";
    await db.exec(`create or replace function public.app_now() returns timestamptz
      language sql stable as $f$ select ${value} $f$`);
    return send(res, 200, { ok: true });
  }
  if (allowTimeTravel && path === "/__test/maintenance") {
    await db.query("select public.run_maintenance()");
    return send(res, 200, { ok: true });
  }

  send(res, 404, { message: `Not available locally: ${path}` });
}

createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
    send(res, 500, { message: error.message });
  });
}).listen(PORT, () => console.log(`Local backend on http://localhost:${PORT}`));
