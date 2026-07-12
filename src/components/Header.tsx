import React from "react";
import { useStore } from "@nanostores/react";
import { cart, totalCount, openDrawer } from "../stores/cart";

export default function Header({ brand, transparentHero = false }: { brand: string; transparentHero?: boolean }) {
  const [scrolled, setScrolled] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [scienceOpen, setScienceOpen] = React.useState(false);
  const $cart = useStore(cart);
  const itemsCount = totalCount($cart);

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 1);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => {
    if (!scienceOpen) return;
    const close = () => setScienceOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [scienceOpen]);

  // Transparent mode only when: hero page AND at top AND not hovered.
  const isTransparent = transparentHero && !scrolled && !hovered;

  return (
    <header
      className="sticky top-[28px] z-50 transition-all duration-500 ease-in-out group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`relative transition-all duration-500 ${scrolled ? "h-20" : "h-32"} group-hover:h-32 ${
          isTransparent ? "bg-transparent border-b border-transparent" : "bg-white border-b border-slate-200"
        }`}
      >
        <div className="relative mx-auto max-w-6xl px-4 h-full flex items-center justify-between">
          <div className="w-full flex items-center justify-between pb-2">
            <a href="/" className="flex items-center">
              <img
                src={isTransparent ? "/logo_white_transparent.png" : "/logo_black_transparent.png"}
                alt="Yoghurt of Youth logo"
                className={`object-contain transition-all duration-500 ${scrolled ? "h-10 md:h-12" : "h-14 md:h-16"} group-hover:h-14 md:group-hover:h-16`}
              />
            </a>

            <nav className={`flex items-center gap-6 font-medium text-xs sm:text-sm md:text-base transition-colors duration-300 ${isTransparent ? "text-white" : "text-slate-900"}`}>
              <div className="flex items-center gap-4 sm:gap-6 leading-none">
                <a href="/shop" className="hover:text-amber-400 transition-colors">Shop</a>
                <a href="/about" className="hover:text-amber-400 transition-colors">About</a>

                {/* Science dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setScienceOpen((o) => !o); }}
                    className="flex items-center gap-1 hover:text-amber-400 transition-colors"
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
                    <div className="absolute left-1/2 -translate-x-1/2 mt-4 w-60 rounded-xl bg-white border border-slate-200 shadow-xl py-2 z-50">
                      <a href="/theory" className="block px-4 py-2 text-sm text-center text-slate-800 hover:bg-slate-100 hover:text-amber-500 transition-colors">
                        A Theory of Gut Dysbiosis
                      </a>
                      <a href="/inflammation" className="block px-4 py-2 text-sm text-center text-slate-800 hover:bg-slate-100 hover:text-amber-500 transition-colors">
                        Microbiome and Inflammation
                      </a>
                      <a href="/lvlv" className="block px-4 py-2 text-sm text-center text-slate-800 hover:bg-slate-100 hover:text-amber-500 transition-colors">
                        LVLV and the Gut-Brain Axis
                      </a>
                      <a href="/skin" className="block px-4 py-2 text-sm text-center text-slate-800 hover:bg-slate-100 hover:text-amber-500 transition-colors">
                        The Gut-Skin Axis
                      </a>
                      <a href="/compare" className="block px-4 py-2 text-sm text-center text-slate-800 hover:bg-slate-100 hover:text-amber-500 transition-colors">
                        L reuteri vs Fermented Foods
                      </a>
                      <a href="/nac" className="block px-4 py-2 text-sm text-center text-slate-800 hover:bg-slate-100 hover:text-amber-500 transition-colors">
                        NAC, Biofilms &amp; Gut Health
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Basket button */}
              <button
                type="button"
                onClick={() => openDrawer()}
                className={`flex items-center gap-2 h-[40px] px-4 rounded-xl transition-all leading-none border ${
                  isTransparent ? "border-white/70 hover:bg-white/10" : "border-slate-300 hover:bg-slate-100"
                }`}
              >
                <img src={isTransparent ? "/basket_icon_white.png" : "/basket_icon.png"} alt="Basket" className="h-5 w-5 select-none" draggable={false} />
                {mounted && itemsCount > 0 && (
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