"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type CoachLinkedStudentAvatarLoader = (coachId: string, episodeId: string, isCurrent: () => boolean) => Promise<Blob | null>;

/** Loads the photo when visible; the caller supplies the relationship-authorized loader. */
export function CoachLinkedStudentAvatar({ coachId, episodeId, className, children, loadAvatar }: {
  readonly coachId: string;
  readonly episodeId: string;
  readonly className: string;
  readonly children: ReactNode;
  readonly loadAvatar: CoachLinkedStudentAvatarLoader;
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
    void loadAvatar(coachId, episodeId, () => current).then((blob) => {
      if (!current || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (current) setUrl(null); });
    return () => { current = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [coachId, episodeId, loadAvatar, visible]);

  return <span ref={element} className={className} aria-hidden="true">
    {url ? /* eslint-disable-next-line @next/next/no-img-element */
      <img src={url} alt="" onError={() => setUrl(null)} /> : children}
  </span>;
}
