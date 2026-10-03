/** Fade sections in as they enter the viewport. Content is visible without JS. */
export function initReveal() {
  const els = document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-in)");
  if (!("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("is-in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.1 },
  );
  els.forEach((el) => io.observe(el));
}
