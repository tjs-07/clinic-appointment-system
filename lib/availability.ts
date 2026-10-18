import type { UpdateFilter } from 'mongodb';
import { overridesCol, ensureDatabaseSchema, type DoctorOverrideDoc } from './db';
import {
  getFastDoctorOverrides,
  updateCachedOverride,
  removeCachedOverride,
  getFastDoctorDateBlock,
  getFastDoctorBlockedSlots,
  getFastDoctorBlockedDates,
} from './cache';

export interface DoctorOverride {
  id: string;
  date: string; // YYYY-MM-DD
  type: 'full_day' | 'specific_slots';
  blockedSlots?: string[]; // e.g. ["10:30", "11:15"]
  reason: string;
  createdAt: string;
}

export async function getAllDoctorOverrides(): Promise<DoctorOverride[]> {
  return getFastDoctorOverrides();
}

export async function saveDoctorOverride(override: DoctorOverride): Promise<DoctorOverride> {
  await ensureDatabaseSchema();

  const update: UpdateFilter<DoctorOverrideDoc> = {
    $set: { date: override.date, type: override.type, reason: override.reason },
    $setOnInsert: { createdAt: override.createdAt },
  };
  if (override.type === 'specific_slots' && Array.isArray(override.blockedSlots)) {
    update.$set = { ...update.$set, blockedSlots: override.blockedSlots };
  } else {
    update.$unset = { blockedSlots: '' };
  }

  await (await overridesCol()).updateOne({ _id: override.id }, update, { upsert: true });

  updateCachedOverride(override);
  return override;
}

export async function deleteDoctorOverride(id: string): Promise<DoctorOverride[]> {
  await ensureDatabaseSchema();
  await (await overridesCol()).deleteOne({ _id: id });
  removeCachedOverride(id);
  return getAllDoctorOverrides();
}

export async function isDateBlockedByDoctor(
  date: string
): Promise<{ blocked: boolean; reason?: string }> {
  return getFastDoctorDateBlock(date);
}

export async function getBlockedSlotsForDate(
  date: string,
  allPossibleSlots?: string[]
): Promise<string[]> {
  return getFastDoctorBlockedSlots(date, allPossibleSlots);
}

export async function getDoctorBlockedDates(): Promise<{ date: string; reason: string }[]> {
  return getFastDoctorBlockedDates();
}
