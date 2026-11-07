const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { test, before, after, beforeEach } = require("node:test");
const fs = require("node:fs");

const PROJECT_ID = "demo-no-project";
const DATABASE_ID = "ai-studio-android-smartpar-a2a0554d-0b51-4849-a077-5da4ba5f341c";

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8085
    }
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  if (testEnv) await testEnv.clearFirestore();
});

test("unauthenticated user cannot read or write profile", async () => {
  const unauthDb = testEnv.unauthenticatedContext().firestore({ databaseId: DATABASE_ID });
  await assertFails(unauthDb.collection("users").doc("user1").get());
  await assertFails(unauthDb.collection("users").doc("user1").set({ fullName: "Ahmed" }));
});

test("authenticated user can read and write own profile", async () => {
  const authDb = testEnv.authenticatedContext("user1").firestore({ databaseId: DATABASE_ID });
  await assertSucceeds(authDb.collection("users").doc("user1").set({ fullName: "Ahmed", pointsBalance: 450 }));
  await assertSucceeds(authDb.collection("users").doc("user1").get());
});

test("user cannot read or write another user's profile", async () => {
  const user1Db = testEnv.authenticatedContext("user1").firestore({ databaseId: DATABASE_ID });
  await assertFails(user1Db.collection("users").doc("user2").get());
  await assertFails(user1Db.collection("users").doc("user2").set({ fullName: "Attacker" }));
});

test("user can create and read own reservations and transactions", async () => {
  const user1Db = testEnv.authenticatedContext("user1").firestore({ databaseId: DATABASE_ID });
  await assertSucceeds(user1Db.collection("users").doc("user1").collection("reservations").doc("res1").set({ slotId: "B2-A14" }));
  await assertSucceeds(user1Db.collection("users").doc("user1").collection("transactions").doc("tx1").set({ points: 50 }));
});

test("user cannot overwrite or steal another user's reserved slot", async () => {
  // Pre-seed a slot reserved by user1
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore({ databaseId: DATABASE_ID });
    await adminDb.collection("mall_slots").doc("dubai_mall_B2_A01").set({
      status: "RESERVED",
      bookedByUid: "user1",
      bookedPlate: "DXB • A-84920"
    });
  });

  const attackerDb = testEnv.authenticatedContext("user2_attacker").firestore({ databaseId: DATABASE_ID });
  const ownerDb = testEnv.authenticatedContext("user1").firestore({ databaseId: DATABASE_ID });

  // Attacker attempting to steal or overwrite user1's slot must fail
  await assertFails(attackerDb.collection("mall_slots").doc("dubai_mall_B2_A01").update({
    bookedByUid: "user2_attacker",
    bookedPlate: "DXB • ATTACK"
  }));

  // Owner user1 updating or releasing their own slot must succeed
  await assertSucceeds(ownerDb.collection("mall_slots").doc("dubai_mall_B2_A01").update({
    status: "AVAILABLE",
    bookedByUid: "",
    bookedPlate: ""
  }));
});

test("negative points balance is rejected", async () => {
  const user1Db = testEnv.authenticatedContext("user1").firestore({ databaseId: DATABASE_ID });
  await assertFails(user1Db.collection("users").doc("user1").set({
    fullName: "Hacker",
    pointsBalance: -500
  }));
});

test("transaction history records are immutable", async () => {
  const user1Db = testEnv.authenticatedContext("user1").firestore({ databaseId: DATABASE_ID });
  await assertSucceeds(user1Db.collection("users").doc("user1").collection("transactions").doc("tx1").set({
    userId: "user1",
    points: 50
  }));
  // Updating or modifying transaction history must fail
  await assertFails(user1Db.collection("users").doc("user1").collection("transactions").doc("tx1").update({
    points: 999999
  }));
});
