import type { Credentials } from 'google-auth-library';
import {
  appointmentsCol,
  patientsCol,
  paymentsCol,
  googleTokensCol,
  ensureDatabaseSchema,
  mapDocToAppointment,
  DEFAULT_FEE,
  type AppointmentDoc,
} from './db';
import {
  getFastAppointments,
  updateCachedAppointment,
  removeCachedAppointment,
  getFastBookedSlotsForDate,
  isFastSlotBooked,
  isFastSlotBookedExcluding,
} from './cache';

export interface Appointment {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  age: number;
  reason: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  message?: string;
  meetLink?: string;
  googleEventId?: string;
  createdAt: string;
  // Status & Payment Management
  status?: 'confirmed' | 'completed' | 'cancelled' | 'no-show';
  paymentStatus?: 'paid' | 'pending' | 'refunded';
  amount?: number; // In INR, default: 800
  paymentMethod?: 'UPI' | 'Card' | 'NetBanking' | 'Cash' | 'Razorpay' | 'Pending';
  paymentId?: string;
  paidAt?: string;
  notes?: string;
  consultationType?: 'online' | 'offline';
}

let inMemoryTokens: Credentials | null = null;
let tokensHydrated = false;

async function ready(): Promise<void> {
  await ensureDatabaseSchema();
  await hydrateGoogleTokens();
}

/** Keeps the denormalised `payments` and `patients` collections in step with an appointment. */
async function syncPatientAndPayment(appt: Appointment): Promise<void> {
  const [appointments, patients, payments] = await Promise.all([
    appointmentsCol(),
    patientsCol(),
    paymentsCol(),
  ]);
  const email = appt.email.trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const paymentId = appt.paymentId || `PAY-${appt.id.slice(0, 8).toUpperCase()}`;

  await payments.updateOne(
    { _id: paymentId },
    {
      $set: {
        appointmentId: appt.id,
        patientName: appt.fullName,
        patientEmail: email,
        patientPhone: appt.phone,
        amount: typeof appt.amount === 'number' ? appt.amount : DEFAULT_FEE,
        paymentMethod: appt.paymentMethod || 'Razorpay',
        paymentStatus: appt.paymentStatus || 'paid',
        paidAt: appt.paidAt || appt.createdAt || nowIso,
      },
    },
    { upsert: true }
  );

  const [stats] = await appointments
    .aggregate<{ totalBookings: number; totalPaid: number; lastVisitDate: string }>([
      { $match: { email } },
      {
        $group: {
          _id: null,
          totalBookings: { $sum: 1 },
          totalPaid: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$paymentStatus', 'paid'] }, { $ne: ['$status', 'cancelled'] }] },
                '$amount',
                0,
              ],
            },
          },
          lastVisitDate: { $max: '$date' },
        },
      },
    ])
    .toArray();

  await patients.updateOne(
    { _id: email },
    {
      $set: {
        fullName: appt.fullName,
        phone: appt.phone,
        age: appt.age,
        totalBookings: stats?.totalBookings ?? 1,
        totalPaid: stats?.totalPaid ?? 0,
        lastVisitDate: stats?.lastVisitDate ?? appt.date,
        updatedAt: nowIso,
      },
      $setOnInsert: { createdAt: appt.createdAt || nowIso },
    },
    { upsert: true }
  );
}

export async function getAllAppointments(forceFresh = false): Promise<Appointment[]> {
  return getFastAppointments(forceFresh);
}

export async function getAppointmentById(id: string): Promise<Appointment | null> {
  await ready();
  const doc = await (await appointmentsCol()).findOne({ _id: id });
  return doc ? mapDocToAppointment(doc) : null;
}

export async function saveAppointment(appointment: Appointment): Promise<Appointment> {
  await ready();

  const saved: Appointment = {
    ...appointment,
    email: appointment.email.trim().toLowerCase(),
    message: appointment.message || '',
    status: appointment.status || 'confirmed',
    paymentStatus: appointment.paymentStatus || 'paid',
    amount: typeof appointment.amount === 'number' ? appointment.amount : DEFAULT_FEE,
    paymentMethod: appointment.paymentMethod || 'Razorpay',
    paymentId: appointment.paymentId || `PAY-${appointment.id.slice(0, 8).toUpperCase()}`,
    paidAt: appointment.paidAt || appointment.createdAt,
    notes: appointment.notes || '',
    consultationType: appointment.consultationType || 'online',
  };

  const { id, ...fields } = saved;
  // Drop undefined optionals so they are not written as nulls
  const clean = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined)
  ) as Omit<AppointmentDoc, '_id'>;

  await (await appointmentsCol()).replaceOne({ _id: id }, clean, { upsert: true });

  updateCachedAppointment(saved);
  await syncPatientAndPayment(saved);
  return saved;
}

export async function updateAppointment(
  id: string,
  updates: Partial<Appointment>
): Promise<Appointment | null> {
  const existing = await getAppointmentById(id);
  if (!existing) return null;

  const updated: Appointment = { ...existing, ...updates, id };
  await saveAppointment(updated);
  return updated;
}

export async function deleteAppointment(id: string): Promise<boolean> {
  await ready();
  const [appointments, patients, payments] = await Promise.all([
    appointmentsCol(),
    patientsCol(),
    paymentsCol(),
  ]);

  const existing = await getAppointmentById(id);
  await payments.deleteMany({ appointmentId: id });
  await appointments.deleteOne({ _id: id });
  removeCachedAppointment(id);

  if (existing) {
    const email = existing.email.trim().toLowerCase();
    const latest = await appointments.find({ email }).sort({ date: -1 }).limit(1).next();
    if (latest) {
      await syncPatientAndPayment(mapDocToAppointment(latest));
    } else {
      await patients.deleteOne({ _id: email });
    }
  }

  return true;
}

export async function getBookedSlotsForDate(date: string): Promise<string[]> {
  return getFastBookedSlotsForDate(date);
}

export async function isSlotBooked(date: string, time: string): Promise<boolean> {
  return isFastSlotBooked(date, time);
}

export async function isSlotBookedExcluding(
  date: string,
  time: string,
  excludeId: string
): Promise<boolean> {
  return isFastSlotBookedExcluding(date, time, excludeId);
}

/* ------------------------------------------------------------------ */
/* Google OAuth tokens (stored in MongoDB, cached in memory)           */
/* ------------------------------------------------------------------ */

function cleanEnv(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

async function hydrateGoogleTokens(): Promise<void> {
  if (tokensHydrated) return;
  tokensHydrated = true;
  try {
    const doc = await (await googleTokensCol()).findOne({ _id: 'doctor' });
    if (doc && !inMemoryTokens) {
      inMemoryTokens = {
        access_token: doc.accessToken || undefined,
        refresh_token: doc.refreshToken || undefined,
        token_type: doc.tokenType || 'Bearer',
        expiry_date: doc.expiryDate || undefined,
      };
    }
  } catch (err) {
    tokensHydrated = false;
    console.warn('[db] Could not load Google OAuth tokens from MongoDB:', err);
  }
}

export function getGoogleTokens(): Credentials | null {
  const envRefresh = process.env.GOOGLE_REFRESH_TOKEN
    ? cleanEnv(process.env.GOOGLE_REFRESH_TOKEN)
    : '';

  if (envRefresh) {
    return { token_type: 'Bearer', ...inMemoryTokens, refresh_token: envRefresh };
  }
  return inMemoryTokens;
}

export function saveGoogleTokens(tokens: Credentials): void {
  const existing = getGoogleTokens();
  const merged: Credentials = {
    ...existing,
    ...tokens,
    refresh_token: tokens.refresh_token || existing?.refresh_token,
  };
  inMemoryTokens = merged;

  const doctorEmail = process.env.DOCTOR_EMAIL || 'tejasmhaske047@gmail.com';
  googleTokensCol()
    .then((col) =>
      col.updateOne(
        { _id: 'doctor' },
        {
          $set: {
            doctorEmail,
            accessToken: merged.access_token || null,
            refreshToken: merged.refresh_token || null,
            tokenType: merged.token_type || 'Bearer',
            expiryDate: merged.expiry_date || null,
            updatedAt: new Date().toISOString(),
          },
        },
        { upsert: true }
      )
    )
    .catch((err) => {
      console.warn('[db] Could not persist Google OAuth tokens to MongoDB:', err);
    });
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export function getGoogleConfig(): GoogleConfig | null {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return {
      clientId: cleanEnv(process.env.GOOGLE_CLIENT_ID),
      clientSecret: cleanEnv(process.env.GOOGLE_CLIENT_SECRET),
    };
  }
  return null;
}
