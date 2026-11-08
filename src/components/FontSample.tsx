import React from "react";
import type { PersonalizationFont } from "../lib/textCustomization";

/** Offscreen font samples use the UI font until they become visible. */
export default function FontSample({
  font,
  children,
}: {
  font: PersonalizationFont;
  children: React.ReactNode;
}) {
  const element = React.useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    if (!element.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  return (
    <span
      ref={element}
      style={visible ? { fontFamily: font.cssFamily } : undefined}
    >
      {children}
    </span>
  );
}
