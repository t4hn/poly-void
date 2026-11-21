import React, { useEffect, useState } from 'react';

interface FadeOverlayProps {
  open: boolean;
  zIndexClass?: string;
  children: React.ReactNode;
}

export const FadeOverlay: React.FC<FadeOverlayProps> = ({
  open,
  zIndexClass = 'z-30',
  children,
}) => {
  const [shouldRender, setShouldRender] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      const raf = requestAnimationFrame(() => {
        setVisible(true);
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setVisible(false);
      const timer = window.setTimeout(() => {
        setShouldRender(false);
      }, 170);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-3 sm:p-4 bg-[#050811]/86 transition-opacity duration-150 ease-out ${
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div
        className={`w-full flex justify-center transition-transform duration-150 ease-out ${
          visible ? 'scale-100 translate-y-0' : 'scale-[0.985] translate-y-1.5'
        }`}
      >
        {children}
      </div>
    </div>
  );
};
