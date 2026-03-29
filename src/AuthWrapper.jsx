import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export { supabase };

const T = {
  bg: "#F5F4F0", white: "#FFFFFF", ink: "#1A1A1A", mid: "#6B6B6B",
  muted: "#A8A8A8", border: "#E0DFDB", accent: "#003366",
  serif: "Georgia, 'Times New Roman', serif",
  sans: "Inter, 'Helvetica Neue', Arial, sans-serif",
};

const LoginScreen = ({ loading, onGoogle }) => (
  <div style={{fontFamily:T.sans,minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
    <div style={{maxWidth:380,width:"100%",textAlign:"center"}}>
      <div style={{marginBottom:40}}>
        <div style={{display:"inline-block",width:3,height:32,background:T.accent,marginBottom:12}}/>
        <h1 style={{fontFamily:T.serif,fontSize:"26px",fontWeight:700,color:T.ink,margin:"0 0 6px",letterSpacing:"-0.02em"}}>Debrief</h1>
        <p style={{color:T.muted,fontSize:"13px",margin:0}}>Meeting intelligence for people who get things done.</p>
      </div>
      <div style={{background:T.white,border:`1px solid ${T.border}`,padding:"32px 28px",marginBottom:20}}>
        <p style={{fontSize:"13px",color:T.mid,margin:"0 0 20px",lineHeight:1.6}}>Sign in to access your workspace. Your data is private and secure.</p>
        <button onClick={onGoogle} disabled={loading}
          style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"11px 16px",border:`1px solid ${T.border}`,borderRadius:2,background:T.white,cursor:loading?"not-allowed":"pointer",fontSize:"14px",fontWeight:500,color:T.ink,fontFamily:T.sans,opacity:loading?0.6:1}}>
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
          </svg>
          {loading?"Signing in…":"Continue with Google"}
        </button>
      </div>
      <p style={{fontSize:"11px",color:T.muted,lineHeight:1.6,margin:0}}>Your data is private. No one else can see your projects or notes.</p>
    </div>
  </div>
);

const LoadingScreen = () => (
  <div style={{fontFamily:T.sans,minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{textAlign:"center"}}>
      <div style={{width:3,height:32,background:T.accent,margin:"0 auto 16px"}}/>
      <p style={{color:T.muted,fontSize:"13px",margin:0}}>Loading your workspace…</p>
    </div>
  </div>
);

export default function AuthWrapper({ children }) {
  const [session, setSession] = useState(undefined);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if(session) saveProfile(session.user);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session);
      if(session) saveProfile(session.user);
    });
    return () => subscription.unsubscribe();
  }, []);

  const saveProfile = async (user) => {
    try {
      await supabase.from('profiles').upsert({
        id: user.id,
        name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        email: user.email,
      }, { onConflict: 'id' });
    } catch(e) {
      console.log('Profile save error:', e);
    }
  };

  const handleGoogle = async () => {
    setAuthLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    setAuthLoading(false);
  };

  if(session === undefined) return <LoadingScreen/>;
  if(!session) return <LoginScreen loading={authLoading} onGoogle={handleGoogle}/>;
  return children;
}
