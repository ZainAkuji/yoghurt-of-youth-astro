import React from "react";
import { useStore } from "@nanostores/react";
import { cart, totalCount, openDrawer } from "../stores/cart";

export default function Header({ brand }: { brand: string }) {
  const [scrolled, setScrolled] = React.useState(false);
  const [scienceOpen, setScienceOpen] = React.useState(false);
  const $cart = useStore(cart);
  const itemsCount = totalCount($cart);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 100);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => {
    if (!scienceOpen) return;
    const close = () => setScienceOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [scienceOpen]);

  return (
    <header className="sticky top-0 z-50 transition-all duration-500 ease-in-out group">
      <div
        className={`relative transition-all duration-500 ${scrolled ? "h-20" : "h-32"} group-hover:h-32`}
        style={{
          backgroundImage: "url('/header_bg.webp')",
          backgroundSize: "cover",
          backgroundPosition: "center 50%",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />

        <div className="relative mx-auto max-w-6xl px-4 h-full flex items-center justify-between">
          <div className="w-full flex items-center justify-between pb-2">
            <a href="/" className="flex items-center">
              <img
                src="/logo_inverted_transparent.png"
                alt="Yoghurt of Youth logo"
                className={`object-contain transition-all duration-500 ${scrolled ? "h-10 md:h-12" : "h-14 md:h-16"} group-hover:h-14 md:group-hover:h-16`}
              />
            </a>

            <nav className="flex items-center gap-6 text-white font-medium text-xs sm:text-sm md:text-base">
              <div className="flex items-center gap-4 sm:gap-6 leading-none">
                <a href="/shop" className="hover:text-amber-300 transition-colors">Shop</a>
                <a href="/about" className="hover:text-amber-300 transition-colors">About</a>

                {/* Science dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setScienceOpen((o) => !o); }}
                    className="flex items-center gap-1 hover:text-amber-300 transition-colors"
                    aria-haspopup="true"
                    aria-expanded={scienceOpen}
                  >
                    Science
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      className={`w-3 h-3 mt-1 transition-transform duration-200 ${scienceOpen ? "rotate-180" : ""}`}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {scienceOpen && (
                    <div className="absolute left-1/2 -translate-x-1/2 mt-4 w-60 rounded-xl bg-black/40 backdrop-blur-xs border border-white/15 shadow-2xl py-2 z-50">
                      <a
                        href="/theory"
                        className="block px-4 py-2 text-sm text-center text-white hover:bg-white/10 hover:text-amber-300 transition-colors"
                      >
                        A Theory of Gut Dysbiosis
                      </a>
                      <a
                        href="/compare"
                        className="block px-4 py-2 text-sm text-center text-white hover:bg-white/10 hover:text-amber-300 transition-colors"
                      >
                        L reuteri vs Fermented Foods
                      </a>
                      <a
                        href="/nac"
                        className="block px-4 py-2 text-sm text-center text-white hover:bg-white/10 hover:text-amber-300 transition-colors"
                      >
                        NAC, Biofilms &amp; Gut Health
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Basket button — links to /shop and flags the drawer to auto-open */}
              <button
                type="button"
                onClick={() => {
                  if (window.location.pathname === "/shop") {
                    openDrawer();
                  } else {
                    window.location.href = "/shop?cart=open";
                  }
                }}
                className="flex items-center gap-2 h-[40px] border border-white/70 px-4 rounded-xl hover:bg-white/10 transition-all leading-none"
              >
                <img src="/basket_icon.png" alt="Basket" className="h-5 w-5 select-none" draggable={false} />
                {itemsCount > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center min-w-[26px] h-[26px] px-2 rounded-lg bg-emerald-500/80 text-black text-xs font-semibold leading-none">
                    {itemsCount}
                  </span>
                )}
              </button>
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}