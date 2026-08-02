import React, { useState, useRef, useEffect } from "react"
import { supabase, getSessionPersistence, setSessionPersistence } from '../lib/supabaseClient';
import { AccessRequestModal, AccessRequestKind } from './AccessRequestModal';
import { Logo } from './Logo';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export function Login() {
  const { session, mfaRequired, checkMfa } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  // Reflects the choice made last time rather than resetting to unticked, so someone who
  // wants to stay signed in does not have to re-tick it at every sign-in.
  const [rememberMe, setRememberMe] = useState(getSessionPersistence)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // MFA state
  const [verifyCode, setVerifyCode] = useState("")
  
  const [accessRequestKind, setAccessRequestKind] = useState<AccessRequestKind | null>(null)

  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])
  const btnRef = useRef<HTMLButtonElement>(null)

  function spawnRipple(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const id = Date.now()
    setRipples((prev) => [...prev, { id, x, y }])
    setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 600)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
        // Before the sign-in, not after: this decides which store the session that is about
        // to be created gets written to.
        setSessionPersistence(rememberMe);

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        if (error) throw error;
        
        await checkMfa();
        
    } catch (err: any) {
        setError(err.message);
    } finally {
        setLoading(false);
    }
  }

  async function handleVerifyMfa(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) throw error;

        const totp = data.all.find(f => f.factor_type === 'totp' && f.status === 'verified');
        if (!totp) {
            throw new Error('No verified TOTP factor found');
        }

        const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: totp.id });
        if (challengeError) throw challengeError;

        const { error: verifyError } = await supabase.auth.mfa.verify({
            factorId: totp.id,
            challengeId: challengeData.id,
            code: verifyCode
        });
        if (verifyError) throw verifyError;

        await checkMfa();
        
    } catch (err: any) {
        setError(err.message || 'Failed to verify 2FA code');
    } finally {
        setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex bg-[#f8fbff]" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* ── Left panel ── */}
      <div
        className="hidden lg:flex flex-col justify-end w-[420px] flex-shrink-0 px-10 py-10"
        style={{ background: "linear-gradient(160deg, #740092 0%, #3a74df 60%, #0092ee 100%)" }}
      >
        {/* Center copy */}
        <div>
          <div className="mb-6 w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M9 11l3 3L22 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="text-white text-[28px] font-semibold leading-snug mb-3">
            Manage your team's workload with confidence
          </h2>
          <p className="text-white/70 text-[14px] leading-relaxed">
            Track capacity, assign tasks, and keep every project moving - all in one place.
          </p>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 relative">
        <div className="w-full" style={{ maxWidth: 380 }}>
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-8">
            <Logo className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0" />
            <span className="font-semibold text-[16px] tracking-tight text-gray-900">WorkFlow Pro</span>
          </div>

          <div className="mb-8">
            <h1 className="text-[24px] font-semibold text-gray-900 mb-1">
                {mfaRequired ? "Two-Factor Authentication" : "Welcome back"}
            </h1>
            <p className="text-[14px] text-gray-500">
                {mfaRequired ? "Enter the code from your authenticator app" : "Sign in to your WorkFlow Pro account"}
            </p>
          </div>

          {mfaRequired ? (
              <form onSubmit={handleVerifyMfa} className="space-y-4">
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-[13px]">
                        {error}
                    </div>
                )}
                
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1.5">
                    6-digit Code
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={6}
                      required
                      placeholder="123456"
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-[13px] text-gray-800 placeholder-gray-400 outline-none transition-all tracking-widest font-mono text-center text-lg"
                      style={{ boxShadow: "none" }}
                      onFocus={e => { e.currentTarget.style.borderColor = "#3a74df"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(58,116,223,0.15)" }}
                      onBlur={e => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = "none" }}
                    />
                  </div>
                </div>
    
                {/* Submit */}
                <button
                  ref={btnRef}
                  type="submit"
                  disabled={loading || verifyCode.length !== 6}
                  onMouseEnter={() => setHovered(true)}
                  onMouseLeave={() => { setHovered(false); setPressed(false) }}
                  onMouseDown={(e) => { setPressed(true); spawnRipple(e) }}
                  onMouseUp={() => setPressed(false)}
                  className="w-full py-2.5 rounded-lg text-[13px] font-semibold text-white flex items-center justify-center gap-2 overflow-hidden relative mt-2"
                  style={{
                    background: (loading || verifyCode.length !== 6) ? "#7aaedf" : "linear-gradient(135deg, #740092, #3a74df 60%, #0092ee)",
                    cursor: (loading || verifyCode.length !== 6) ? "not-allowed" : "pointer",
                    transform: pressed ? "scale(0.97)" : hovered ? "translateY(-2px)" : "translateY(0)",
                    boxShadow: pressed
                      ? "0 2px 8px rgba(58,116,223,0.3)"
                      : hovered
                      ? "0 8px 24px rgba(116,0,146,0.35), 0 4px 12px rgba(0,146,238,0.25)"
                      : "0 2px 8px rgba(58,116,223,0.2)",
                    transition: "transform 0.15s ease, box-shadow 0.2s ease",
                  }}
                >
                  {ripples.map((r) => (
                    <span
                      key={r.id}
                      style={{
                        position: "absolute",
                        left: r.x,
                        top: r.y,
                        width: 8,
                        height: 8,
                        marginLeft: -4,
                        marginTop: -4,
                        borderRadius: "50%",
                        backgroundColor: "rgba(255,255,255,0.4)",
                        transform: "scale(0)",
                        animation: "ripple 0.6s ease-out forwards",
                        pointerEvents: "none",
                      }}
                    />
                  ))}
                  {loading ? (
                    <>
                      <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <circle cx="7" cy="7" r="5.5" stroke="white" strokeWidth="1.5" strokeOpacity="0.3" />
                        <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      Verifying...
                    </>
                  ) : (
                    "Verify Code"
                  )}
                </button>
                
                <div className="text-center mt-4">
                    <button 
                        type="button"
                        onClick={() => {
                            supabase.auth.signOut();
                        }}
                        className="text-[13px] text-gray-500 hover:text-gray-700 font-medium transition-colors"
                    >
                        Sign in as different user
                    </button>
                </div>
              </form>
          ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-[13px]">
                        {error}
                    </div>
                )}
                
                {/* Email */}
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1.5">
                    Email address
                  </label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                        <rect x="1.5" y="3" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                        <path d="M1.5 5.5l6 4 6-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                    </div>
                    <input
                      type="email"
                      required
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 bg-white text-[13px] text-gray-800 placeholder-gray-400 outline-none transition-all"
                      style={{ boxShadow: "none" }}
                      onFocus={e => { e.currentTarget.style.borderColor = "#3a74df"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(58,116,223,0.15)" }}
                      onBlur={e => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = "none" }}
                    />
                  </div>
                </div>
    
                {/* Password */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[13px] font-medium text-gray-700">Password</label>
                    <button type="button" className="text-[12px] font-medium transition-colors" style={{ color: "#3a74df" }}>
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                        <rect x="3" y="6.5" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                        <path d="M5 6.5V4.5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        <circle cx="7.5" cy="10" r="1" fill="currentColor" />
                      </svg>
                    </div>
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-9 pr-9 py-2.5 rounded-lg border border-gray-200 bg-white text-[13px] text-gray-800 placeholder-gray-400 outline-none transition-all"
                      style={{ boxShadow: "none" }}
                      onFocus={e => { e.currentTarget.style.borderColor = "#3a74df"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(58,116,223,0.15)" }}
                      onBlur={e => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = "none" }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPassword ? (
                        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                          <path d="M2 2l11 11M6.2 6.4A2 2 0 0 0 9.5 9.6M4 4.3C2.8 5.2 1.8 6.3 1 7.5c1.5 2.5 4 4 6.5 4 1.1 0 2.2-.3 3.1-.8M8 3.6C7.8 3.5 7.7 3.5 7.5 3.5c-2.5 0-5 1.5-6.5 4 .4.7.9 1.3 1.4 1.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                          <path d="M1 7.5C2.5 5 5 3.5 7.5 3.5S12.5 5 14 7.5C12.5 10 10 11.5 7.5 11.5S2.5 10 1 7.5Z" stroke="currentColor" strokeWidth="1.3" />
                          <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
    
                {/* Remember me */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRememberMe((v) => !v)}
                    className="w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors"
                    style={{
                      borderColor: rememberMe ? "#3a74df" : "#d1d5db",
                      backgroundColor: rememberMe ? "#3a74df" : "transparent",
                    }}
                  >
                    {rememberMe && (
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                        <path d="M1.5 4.5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                  <span className="text-[13px] text-gray-600">Keep me signed in for 30 days</span>
                </div>
    
                {/* Submit */}
                <button
                  ref={btnRef}
                  type="submit"
                  disabled={loading}
                  onMouseEnter={() => setHovered(true)}
                  onMouseLeave={() => { setHovered(false); setPressed(false) }}
                  onMouseDown={(e) => { setPressed(true); spawnRipple(e) }}
                  onMouseUp={() => setPressed(false)}
                  className="w-full py-2.5 rounded-lg text-[13px] font-semibold text-white flex items-center justify-center gap-2 overflow-hidden relative mt-2"
                  style={{
                    background: loading ? "#7aaedf" : "linear-gradient(135deg, #740092, #3a74df 60%, #0092ee)",
                    cursor: loading ? "not-allowed" : "pointer",
                    transform: pressed ? "scale(0.97)" : hovered ? "translateY(-2px)" : "translateY(0)",
                    boxShadow: pressed
                      ? "0 2px 8px rgba(58,116,223,0.3)"
                      : hovered
                      ? "0 8px 24px rgba(116,0,146,0.35), 0 4px 12px rgba(0,146,238,0.25)"
                      : "0 2px 8px rgba(58,116,223,0.2)",
                    transition: "transform 0.15s ease, box-shadow 0.2s ease",
                  }}
                >
                  {ripples.map((r) => (
                    <span
                      key={r.id}
                      style={{
                        position: "absolute",
                        left: r.x,
                        top: r.y,
                        width: 8,
                        height: 8,
                        marginLeft: -4,
                        marginTop: -4,
                        borderRadius: "50%",
                        backgroundColor: "rgba(255,255,255,0.4)",
                        transform: "scale(0)",
                        animation: "ripple 0.6s ease-out forwards",
                        pointerEvents: "none",
                      }}
                    />
                  ))}
                  {loading ? (
                    <>
                      <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <circle cx="7" cy="7" r="5.5" stroke="white" strokeWidth="1.5" strokeOpacity="0.3" />
                        <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      Signing in…
                    </>
                  ) : (
                    "Sign in to WorkFlow Pro"
                  )}
                </button>
              </form>
          )}

          <p className="text-center text-[12px] text-gray-500 mt-6">
            Don't have an account?{" "}
            <button
              type="button"
              onClick={() => setAccessRequestKind('access')}
              className="font-medium transition-colors hover:underline"
              style={{ color: "#3a74df" }}
            >
              Request access
            </button>
          </p>
          {/* A deleted account cannot sign in at all, so this is the only door left for it.
              A deactivated one is turned away after signing in and offered the same thing
              there. Neither route says whether the address is known. */}
          <p className="text-center text-[12px] text-gray-500 mt-2">
            Account deactivated?{" "}
            <button
              type="button"
              onClick={() => setAccessRequestKind('reactivation')}
              className="font-medium transition-colors hover:underline"
              style={{ color: "#3a74df" }}
            >
              Request reactivation
            </button>
          </p>
        </div>

        {accessRequestKind && (
          <AccessRequestModal
            kind={accessRequestKind}
            defaultEmail={email}
            onClose={() => setAccessRequestKind(null)}
          />
        )}

        {/* Footer */}
        <p className="absolute bottom-6 text-[11px] text-gray-400">
          © 2026 WorkFlow Pro · Privacy · Terms
        </p>
      </div>
      
      {/* Add animation for ripples */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes ripple {
          to {
            transform: scale(25);
            opacity: 0;
          }
        }
      `}} />
    </div>
  )
}
