"use client";

import { useEffect, useRef, useState } from "react";
import { getCoachStudentRecordGateway, type CoachStudentRecordSubject,
  type SharedStudentPhoto } from "../data/coach-student-record-gateway";
import styles from "./coach-student-record.module.css";

export function CoachStudentAvatar({ coachId, episodeId, subject, initials }: {
  readonly coachId: string; readonly episodeId: string;
  readonly subject: CoachStudentRecordSubject; readonly initials: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    let objectUrl: string | null = null;
    setUrl(null);
    if (subject.avatarPath) {
      void getCoachStudentRecordGateway(coachId, episodeId, () => current)
        .downloadAvatar(subject).then((blob) => {
          if (!current) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }).catch(() => { if (current) setUrl(null); });
    } else setUrl(null);
    return () => { current = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [coachId, episodeId, subject]);
  return <span className={styles.avatar} aria-hidden="true">
    {url ? /* eslint-disable-next-line @next/next/no-img-element */
      <img src={url} alt="" onError={() => setUrl(null)} /> : initials}
  </span>;
}

export function SharedPhotoThumbnail({ coachId, episodeId, photo }: {
  readonly coachId: string; readonly episodeId: string; readonly photo: SharedStudentPhoto;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const target = element.current;
    if (!target || visible) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let current = true;
    let objectUrl: string | null = null;
    void getCoachStudentRecordGateway(coachId, episodeId, () => current)
      .download(photo).then((blob) => {
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }).catch(() => { if (current) setUrl(null); });
    return () => { current = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [coachId, episodeId, photo, visible]);
  return <span ref={element} className={styles.photoPlaceholder} aria-hidden="true">
    {url ? /* eslint-disable-next-line @next/next/no-img-element */
      <img src={url} alt="" onError={() => setUrl(null)} /> : "◇"}
  </span>;
}
