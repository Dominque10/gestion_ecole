"use client";

import { useEffect } from "react";
import { offlineDb, type OfflineCourse, type OfflineSheet, type Owner } from "@/lib/offline/db";
import { saveCourseCopy } from "@/lib/offline/store";
import { rememberOwner } from "./sync-client";

/**
 * Garde sur le téléphone la matière qui vient d'être ouverte avec du réseau (élèves, évaluations,
 * notes) : elle pourra être notée sans réseau (hypothèse H82). N'affiche rien.
 */
export function CourseCopy({
  owner,
  course,
  sheets,
}: {
  owner: Owner;
  course: Omit<OfflineCourse, "key" | "owner" | "savedAt">;
  sheets: Omit<OfflineSheet, "key" | "owner" | "classId" | "subjectId" | "savedAt">[];
}) {
  useEffect(() => {
    rememberOwner(owner);
    void saveCourseCopy(offlineDb(), { ...course, owner }, sheets);
  }, [owner, course, sheets]);
  return null;
}
