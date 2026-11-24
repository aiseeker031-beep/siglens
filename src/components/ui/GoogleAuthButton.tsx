import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, Copy, ExternalLink, KeyRound, LogOut, ShieldCheck, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { KINETIC_EASE } from './Kinetic';

const GoogleMark: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
    />
    <path
      fill="#34A853"
      d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"
    />
    <path
      fill="#EA4335"
      d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
    />
  </svg>
);

export const GoogleAuthButton: React.FC<{
  compact?: boolean;
  tone?: 'light' | 'dark';
  label?: string;
  onContinueToApp?: () => void;
  className?: string;
}> = ({
  compact = false,
  tone = 'light',
  label,
  onContinueToApp,
  className = '',
}) => {
  const auth = useAppStore((s) => s.auth);
  const fetchAuthState = useAppStore((s) => s.fetchAuthState);
  const logoutAuth = useAppStore((s) => s.logoutAuth);

  const [menuOpen, setMenuOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!auth) {
      fetchAuthState();
    }
  }, [auth, fetchAuthState]);

  useEffect(() => {
    if (!setupOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSetupOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setupOpen]);

  const handleSignInClick = async () => {
    setChecking(true);
    const latest = auth ?? (await fetchAuthState());
    setChecking(false);
    if (latest?.configured) {
      window.location.href = '/api/auth/google';
    } else {
      setSetupOpen(true);
    }
  };

  const copyText = (key: string, value: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1600);
  };

  const user = auth?.user ?? null;

  if (user) {
    const initials = (user.name || user.email)
      .split(' ')
      .map((s) => s[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    return (
      <div className={`relative ${className}`}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className={`inline-flex items-center gap-2 rounded-full border transition-colors ${
            compact ? 'pl-1 pr-2.5 py-1 text-xs' : 'pl-1.5 pr-3.5 py-1.5 text-xs'
          } ${
            tone === 'dark'
              ? 'bg-white/[0.08] border-white/[0.14] text-white hover:bg-white/[0.14]'
              : 'bg-white border-[#E5EAE7] text-[#111814] hover:border-[#C6D8C7]'
          }`}
        >
          {user.picture ? (
            <img
              src={user.picture}
              alt={user.name}
              referrerPolicy="no-referrer"
              className="w-6 h-6 rounded-full object-cover border border-[#22C55E]/40"
            />
          ) : (
            <span className="w-6 h-6 rounded-full bg-[#16A34A] text-white text-[10px] font-bold flex items-center justify-center">
              {initials}
            </span>
          )}
          <span className="font-semibold max-w-[110px] truncate hidden sm:inline">
            {user.name}
          </span>
        </button>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.16, ease: KINETIC_EASE }}
              className="absolute right-0 mt-2 w-64 rounded-2xl bg-white border border-[#E5EAE7] shadow-2xl z-50 overflow-hidden text-[#111814]"
            >
              <div className="px-4 py-3 border-b border-[#EDF1EE] bg-[#F8FAF9]">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#16A34A]">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Google Session Active
                </div>
                <div className="text-xs font-bold text-[#111814] mt-1 truncate">{user.name}</div>
                <div className="text-[11px] text-[#637369] truncate">{user.email}</div>
              </div>
              <div className="p-2 space-y-1">
                {onContinueToApp && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onContinueToApp();
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-[#111814] hover:bg-[#F3F6F4] transition-colors"
                  >
                    <span>Open Dashboard</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#16A34A]" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    setMenuOpen(false);
                    await logoutAuth();
                    window.location.href = '/';
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-[#BE123C] hover:bg-[#FFF1F2] transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const buttonText = label ?? (compact ? 'Google Sign in' : 'Continue with Google');

  return (
    <>
      <button
        type="button"
        onClick={handleSignInClick}
        disabled={checking}
        className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all whitespace-nowrap disabled:opacity-60 ${
          compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-xs sm:text-sm'
        } ${
          tone === 'dark'
            ? 'bg-white text-[#111814] hover:bg-[#F3F6F4] shadow-[0_4px_14px_rgba(0,0,0,0.22)]'
            : 'bg-white text-[#111814] border border-[#DCE3DF] hover:border-[#16A34A]/60 hover:bg-[#F8FAF9] shadow-[0_1px_4px_rgba(12,20,16,0.06)]'
        } ${className}`}
      >
        <GoogleMark className={compact ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0'} />
        <span>{checking ? 'Checking...' : buttonText}</span>
      </button>

      {/* Honest Google OAuth Setup Modal rendered via Portal so sticky backdrop-blur headers never trap fixed positioning */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {setupOpen && (
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="Google OAuth Configuration"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#0B120E]/60 backdrop-blur-sm overflow-y-auto"
                onClick={() => setSetupOpen(false)}
              >
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.22, ease: KINETIC_EASE }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-lg rounded-3xl bg-white border border-[#E5EAE7] shadow-2xl overflow-hidden text-[#111814] my-auto"
                >
                  <div className="px-6 py-5 border-b border-[#EDF1EE] flex items-start justify-between gap-4 bg-[#F8FAF9]">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-white border border-[#E5EAE7] flex items-center justify-center shadow-sm shrink-0">
                        <GoogleMark className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-[#111814]">
                          Connect Google OAuth 2.0 Credentials
                        </h3>
                        <p className="text-xs text-[#637369] mt-0.5">
                          OAuth routes &amp; SQLite sessions are active — add your Google Cloud keys to enable sign-in.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSetupOpen(false)}
                      aria-label="Close modal"
                      className="p-1.5 rounded-lg text-[#637369] hover:text-[#111814] hover:bg-[#EDF1EE] shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-6 space-y-4 text-xs">
                    <div className="rounded-2xl bg-[#F4F7F5] border border-[#E2EAE5] p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#55665C]">
                          1. Authorized Redirect URI
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            copyText(
                              'cb',
                              auth?.callbackUrl || `${window.location.origin}/api/auth/google/callback`,
                            )
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#16A34A] hover:underline"
                        >
                          {copiedKey === 'cb' ? (
                            <>
                              <Check className="w-3 h-3" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" /> Copy URI
                            </>
                          )}
                        </button>
                      </div>
                      <code className="block px-3 py-2 rounded-xl bg-white border border-[#E5EAE7] font-mono text-[11px] text-[#111814] break-all">
                        {auth?.callbackUrl || `${window.location.origin}/api/auth/google/callback`}
                      </code>
                    </div>

                    <div className="rounded-2xl bg-[#F4F7F5] border border-[#E2EAE5] p-3.5 space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[#55665C]">
                        <KeyRound className="w-3.5 h-3.5 text-[#16A34A]" />
                        2. Add Env Vars in Hostcry cPanel → Setup Node.js App
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px]">
                        <div className="px-3 py-2 rounded-xl bg-white border border-[#E5EAE7] font-semibold text-[#111814]">
                          GOOGLE_CLIENT_ID
                        </div>
                        <div className="px-3 py-2 rounded-xl bg-white border border-[#E5EAE7] font-semibold text-[#111814]">
                          GOOGLE_CLIENT_SECRET
                        </div>
                      </div>
                      <p className="text-[11px] text-[#637369] leading-relaxed">
                        Create an OAuth 2.0 Web Client in Google Cloud Console, paste both keys in cPanel Environment Variables, and restart the Node.js app.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <a
                        href="https://console.cloud.google.com/apis/credentials"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#16A34A] hover:underline"
                      >
                        Google Cloud Console
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSetupOpen(false)}
                          className="px-3.5 py-2 rounded-full border border-[#DCE3DF] text-xs font-semibold text-[#55665C] hover:text-[#111814]"
                        >
                          Close
                        </button>
                        {onContinueToApp && (
                          <button
                            type="button"
                            onClick={() => {
                              setSetupOpen(false);
                              onContinueToApp();
                            }}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full sig-btn-primary text-xs font-semibold"
                          >
                            Continue to Dashboard
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
};

