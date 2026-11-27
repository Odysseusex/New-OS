import { BakerNoteKind, BakerTripStatus, LocationType, ProductType, Role, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { AuthenticatedUser } from "../auth/auth.types";
import { pinDigest } from "../auth/till-pin";
import { BakerNotesService } from "./baker-notes.service";
import { PrintJobsService } from "./print-jobs.service";
import { BakerTripsService } from "./baker-trips.service";
import { StaffPushService } from "./staff-push.service";

// «Рейс»: one baker's «Рейс готов» only waits and notifies the other; the trip launches when every baker
// has pressed, and then the day's new notes go to the door laptop as one print request — never twice.

const prisma = new PrismaService();
const notes = new BakerNotesService(prisma);
const printJobs = new PrintJobsService(prisma, notes);
const push = new StaffPushService(prisma);
const sent: { endpoint: string; payload: string }[] = [];
push.transport = async (target, payload) => {
  sent.push({ endpoint: target.endpoint, payload });
};
const trips = new BakerTripsService(prisma, printJobs, push);

let org: IsolatedOrg;
let breadId: string;
let baker: AuthenticatedUser;
let baker2: AuthenticatedUser;
let dispatcher: AuthenticatedUser;

const flush = () => new Promise((r) => setTimeout(r, 300));

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "baker-trips");
  const id = org.organizationId;
  const workshopId = (await prisma.location.create({ data: { organizationId: id, name: "Цех", type: LocationType.BAKERY_PRODUCTION, city: "Тест", address: "—" } })).id;
  breadId = (await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "BT-1", type: ProductType.FINISHED_GOOD, price: 300, unit: Unit.PCS } })).id;
  const person = async (name: string, pin: string | null, role: Role, locationId: string | null): Promise<AuthenticatedUser> => {
    const row = await prisma.user.create({
      data: { organizationId: id, fullName: name, email: `${pin ?? name.length}-${name.length}-${id}@iso.test`, passwordHash: "x", role, locationId, pinDigest: pin ? pinDigest(id, pin) : null },
    });
    return { id: row.id, email: row.email, fullName: name, role, title: null, organizationId: id, regionId: null, locationId };
  };
  baker = await person("Пекарь Айгуль", "4821", Role.PRODUCTION_STAFF, workshopId);
  baker2 = await person("Кондитер Марат", "7730", Role.PRODUCTION_STAFF, workshopId);
  dispatcher = await person("Ноутбук", null, Role.DISPATCHER, org.storeId);
  await push.subscribe(id, baker2.id, { endpoint: "https://fcm.googleapis.com/fcm/send/marat", p256dh: "k", auth: "a" });
  await push.subscribe(id, baker.id, { endpoint: "https://fcm.googleapis.com/fcm/send/aigul", p256dh: "k", auth: "a" });
});

afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const note = (user: AuthenticatedUser, quantity: number) =>
  notes.create(user, { kind: BakerNoteKind.DELIVERY, locationId: org.storeId, lines: [{ productId: breadId, quantity }] });

it("refuses a trip with nothing new to print", async () => {
  await expect(trips.confirm(baker)).rejects.toThrow("Новых накладных нет");
});

it("waits for every baker, notifies the one missing, then prints the new notes once", async () => {
  const a = await note(baker, 10);
  const b = await note(baker2, 5);

  const first = await trips.confirm(baker);
  expect(first.launched).toBeNull();
  expect(first.state.waiting?.number).toBe(1);
  expect(first.state.waiting?.missing.map((m) => m.userName)).toEqual(["Кондитер Марат"]);
  expect(first.state.youConfirmed).toBe(true);
  await flush();
  expect(sent.map((s) => s.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/marat"]);
  expect(JSON.parse(sent[0].payload).title).toBe("Рейс 1: ждём вас");
  expect(await prisma.printJob.count({ where: { organizationId: org.organizationId } })).toBe(0);

  // Pressing again changes nothing and notifies nobody.
  await trips.confirm(baker);
  await flush();
  expect(sent).toHaveLength(1);

  // A note written while the trip waits still goes with it.
  const c = await note(baker, 3);
  const second = await trips.confirm(baker2);
  expect(second.launched?.status).toBe(BakerTripStatus.LAUNCHED);
  expect(second.launched?.noteCount).toBe(3);
  expect(second.state.waiting).toBeNull();
  const jobs = await prisma.printJob.findMany({ where: { organizationId: org.organizationId } });
  expect(jobs).toHaveLength(1);
  expect(new Set(jobs[0].noteIds)).toEqual(new Set([a.id, b.id, c.id]));
  expect((await notes.findOne(baker, a.id)).tripNumber).toBe(1);

  // The laptop prints them: nothing is new any more.
  await printJobs.pending(dispatcher);
  await printJobs.claim(dispatcher, jobs[0].id);
  expect((await trips.state(baker)).newNotes).toBe(0);
  await expect(trips.confirm(baker)).rejects.toThrow("Новых накладных нет");
});

it("a second trip prints only what is new or changed, and a press can be taken back", async () => {
  const d = await note(baker2, 7);
  await trips.confirm(baker2);
  let state = await trips.withdraw(baker2);
  expect(state.state.waiting).toBeNull();

  await trips.confirm(baker2);
  const launched = await trips.force({ ...org.user, role: Role.OWNER });
  expect(launched.launched?.number).toBe(2);
  expect(launched.launched?.forcedByName).toBeTruthy();
  const job = await prisma.printJob.findFirstOrThrow({ where: { organizationId: org.organizationId, claimedAt: null } });
  expect(job.noteIds).toEqual([d.id]);
  state = { state: await trips.state(baker), launched: null };
  expect(state.state.last?.number).toBe(2);
});
