import crypto from 'crypto';
import { MongoClient, type Collection, type Db } from 'mongodb';
import type { Appointment } from './storage';

/* ------------------------------------------------------------------ */
/* Document shapes                                                     */
/* ------------------------------------------------------------------ */

export interface AppointmentDoc {
  _id: string;
  fullName: string;
  phone: string;
  email: string;
  age: number;
  reason: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  message: string;
  meetLink?: string;
  googleEventId?: string;
  status: 'confirmed' | 'completed' | 'cancelled' | 'no-show';
  paymentStatus: 'paid' | 'pending' | 'refunded';
  amount: number;
  paymentMethod: 'UPI' | 'Card' | 'NetBanking' | 'Cash' | 'Razorpay' | 'Pending';
  paymentId: string;
  paidAt: string;
  notes: string;
  consultationType: 'online' | 'offline';
  createdAt: string;
}

export interface PatientDoc {
  _id: string; // lower-cased email
  fullName: string;
  phone: string;
  age: number;
  totalBookings: number;
  totalPaid: number;
  lastVisitDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentDoc {
  _id: string; // payment id
  appointmentId: string;
  patientName: string;
  patientEmail: string;
  patientPhone: string;
  amount: number;
  paymentMethod: string;
  paymentStatus: string;
  paidAt: string;
}

export interface DoctorOverrideDoc {
  _id: string;
  date: string; // YYYY-MM-DD
  type: 'full_day' | 'specific_slots';
  blockedSlots?: string[];
  reason: string;
  createdAt: string;
}

export interface GoogleTokenDoc {
  _id: 'doctor';
  doctorEmail: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiryDate?: number | null;
  updatedAt: string;
}

export interface AdminDoc {
  _id: string; // login username
  email: string;
  name: string;
  role: 'admin';
  passwordHash: string; // scrypt$<salt>$<hash>
  createdAt: string;
}

export const DEFAULT_FEE = 800; // consultation fee in INR

export function mapDocToAppointment(doc: AppointmentDoc): Appointment {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    id: _id,
    message: rest.message || '',
    meetLink: rest.meetLink || undefined,
    googleEventId: rest.googleEventId || undefined,
    status: rest.status || 'confirmed',
    paymentStatus: rest.paymentStatus || 'paid',
    amount: typeof rest.amount === 'number' ? rest.amount : DEFAULT_FEE,
    paymentMethod: rest.paymentMethod || 'Razorpay',
    paymentId: rest.paymentId || `PAY-${_id.slice(0, 8).toUpperCase()}`,
    paidAt: rest.paidAt || rest.createdAt,
    notes: rest.notes || '',
    consultationType: rest.consultationType === 'offline' ? 'offline' : 'online',
  };
}

/* ------------------------------------------------------------------ */
/* Admin seed (single admin account)                                   */
/* ------------------------------------------------------------------ */

export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin@123';
const ADMIN_SEED_PASSWORD = process.env.ADMIN_PASSWORD || 'pass@123';
export const ADMIN_EMAIL = process.env.DOCTOR_EMAIL || 'tejasmhaske047@gmail.com';
export const ADMIN_NAME = 'Dr. Aarav Mehta';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

declare global {
  // eslint-disable-next-line no-var
  var __mongoClientPromise: Promise<MongoClient> | undefined;
  // eslint-disable-next-line no-var
  var __schemaPromise: Promise<void> | undefined;
}

function explainMongoError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/alert (number )?80|tlsv1 alert internal error|ReplicaSetNoPrimary|ECONNRESET|Server selection timed out/i.test(msg)) {
    return new Error(
      'Could not connect to MongoDB Atlas (TLS/handshake failed). Most common cause: your current IP address is not allowed in Atlas -> Security -> Network Access. ' +
        'Add your IP (or 0.0.0.0/0 for testing), wait ~1 minute, then restart "npm run dev". Also check the cluster is not paused. Original error: ' +
        msg
    );
  }
  if (/bad auth|Authentication failed/i.test(msg)) {
    return new Error(
      'MongoDB authentication failed. Check the database username/password in MONGODB_URI (Atlas -> Security -> Database Access). Original error: ' + msg
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

function getClientPromise(): Promise<MongoClient> {
  if (!global.__mongoClientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error(
        'MONGODB_URI is not set. Copy .env.example to .env.local and add your MongoDB Atlas connection string.'
      );
    }
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
      family: 4, // force IPv4: avoids TLS/handshake failures on networks with broken IPv6
    });
    global.__mongoClientPromise = client.connect().catch((err) => {
      // Allow a retry on the next request instead of caching the failure
      global.__mongoClientPromise = undefined;
      throw explainMongoError(err);
    });
  }
  return global.__mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db(process.env.MONGODB_DB || 'homeopathy_clinic');
}

export async function appointmentsCol(): Promise<Collection<AppointmentDoc>> {
  return (await getDb()).collection<AppointmentDoc>('appointments');
}
export async function patientsCol(): Promise<Collection<PatientDoc>> {
  return (await getDb()).collection<PatientDoc>('patients');
}
export async function paymentsCol(): Promise<Collection<PaymentDoc>> {
  return (await getDb()).collection<PaymentDoc>('payments');
}
export async function overridesCol(): Promise<Collection<DoctorOverrideDoc>> {
  return (await getDb()).collection<DoctorOverrideDoc>('doctor_availability');
}
export async function googleTokensCol(): Promise<Collection<GoogleTokenDoc>> {
  return (await getDb()).collection<GoogleTokenDoc>('google_oauth_tokens');
}
export async function adminsCol(): Promise<Collection<AdminDoc>> {
  return (await getDb()).collection<AdminDoc>('admins');
}

/**
 * Creates indexes and makes sure the one admin account exists.
 * Safe to call on every request; the work runs once per server instance.
 */
export async function ensureDatabaseSchema(): Promise<void> {
  if (!global.__schemaPromise) {
    global.__schemaPromise = (async () => {
      const [appointments, patients, payments, overrides, admins] = await Promise.all([
        appointmentsCol(),
        patientsCol(),
        paymentsCol(),
        overridesCol(),
        adminsCol(),
      ]);

      await Promise.all([
        appointments.createIndex({ date: 1, time: 1 }),
        appointments.createIndex({ email: 1 }),
        appointments.createIndex({ status: 1 }),
        payments.createIndex({ appointmentId: 1 }),
        overrides.createIndex({ date: 1 }),
        patients.createIndex({ lastVisitDate: -1 }),
      ]);

      // Single admin: keep exactly one account, created on first run.
      await admins.deleteMany({ _id: { $ne: ADMIN_USERNAME } });
      await admins.updateOne(
        { _id: ADMIN_USERNAME },
        {
          $set: { email: ADMIN_EMAIL, name: ADMIN_NAME },
          $setOnInsert: {
            role: 'admin' as const,
            passwordHash: hashPassword(ADMIN_SEED_PASSWORD),
            createdAt: new Date().toISOString(),
          },
        },
        { upsert: true }
      );
    })().catch((err) => {
      global.__schemaPromise = undefined;
      throw err;
    });
  }
  return global.__schemaPromise;
}