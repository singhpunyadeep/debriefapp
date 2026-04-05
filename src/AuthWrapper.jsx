import { createClient } from "@supabase/supabase-js";
import { useState, useEffect } from "react";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const signIn = async () => {
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
};

// ── Design tokens (matches App.jsx) ──────────────────────────────────────────
const ink = "#1A1A1A";
const muted = "#9CA3AF";
const accent = "#003366";
const accentLight = "#EEF2FF";
const border = "#E5E7EB";
const white = "#FFFFFF";
const bg = "#F7F6F3";
const serif = "'Georgia', 'Times New Roman', serif";
const sans = "'system-ui', '-apple-system', sans-serif";

// ── Filmstrip screenshots data ────────────────────────────────────────────────
const SCREENS = [
  {
    label: "Meeting Notes → Instant Summary",
    desc: "Paste raw notes. Debrief structures them into decisions, actions, and next steps in seconds.",
    color: "#003366",
    content: (
      <div style={{fontFamily:sans,fontSize:"11px",lineHeight:1.5}}>
        <div style={{background:"#F7F6F3",border:`1px solid ${border}`,borderRadius:4,padding:"10px 12px",marginBottom:8}}>
          <div style={{fontWeight:700,color:accent,fontSize:"10px",letterSpacing:"0.06em",marginBottom:6}}>MEETING NOTES</div>
          <div style={{color:"#555",fontSize:"10px",lineHeight:1.6}}>
            Discussed vendor API delay. Rahul to share credentials by Friday. Decided to compress UAT from 6 to 4 weeks. CFO approved ₹4.2Cr budget...
          </div>
        </div>
        <div style={{textAlign:"center",color:accent,fontSize:"14px",margin:"6px 0"}}>↓ AI</div>
        <div style={{background:white,border:`1px solid ${border}`,borderRadius:4,padding:"10px 12px"}}>
          <div style={{fontWeight:700,color:"#16A34A",fontSize:"10px",marginBottom:4}}>✓ STRUCTURED SUMMARY</div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {["📌 Decision: Compress UAT to 4 weeks","⚡ Commitment: Rahul → API credentials by Fri","⚠ Risk: Budget approval pending CFO sign-off"].map(item=>(
              <div key={item} style={{fontSize:"10px",color:ink,background:"#F7F6F3",padding:"4px 8px",borderRadius:3}}>{item}</div>
            ))}
          </div>
        </div>
      </div>
    ),
  },
  {
    label: "Track Commitments Across Meetings",
    desc: "Every promise made in every meeting — tracked, owned, followed up. Never lose a commitment again.",
    color: "#1D4ED8",
    content: (
      <div style={{fontFamily:sans}}>
        <div style={{fontWeight:700,fontSize:"10px",color:muted,letterSpacing:"0.06em",marginBottom:8}}>COMMITMENT RELIABILITY</div>
        {[
          {name:"Rahul Verma",pct:61,color:"#F59E0B",open:3,done:5},
          {name:"Priya Mehta",pct:88,color:"#16A34A",open:1,done:7},
          {name:"Ananya Singh",pct:75,color:"#16A34A",open:2,done:6},
        ].map(m=>(
          <div key={m.name} style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <span style={{fontSize:"11px",fontWeight:600,color:ink}}>{m.name}</span>
              <span style={{fontSize:"11px",fontWeight:700,color:m.color}}>{m.pct}%</span>
            </div>
            <div style={{background:border,borderRadius:2,height:5,overflow:"hidden"}}>
              <div style={{background:m.color,height:"100%",width:`${m.pct}%`,borderRadius:2}}/>
            </div>
            <div style={{fontSize:"9px",color:muted,marginTop:2}}>{m.done} closed · {m.open} open</div>
          </div>
        ))}
      </div>
    ),
  },
  {
    label: "Pre-Meeting Intelligence Brief",
    desc: "Walk into every meeting fully briefed. Debrief surfaces open items, overdue commitments, and risks automatically.",
    color: "#7C3AED",
    content: (
      <div style={{fontFamily:sans,fontSize:"11px"}}>
        <div style={{fontWeight:700,color:"#7C3AED",fontSize:"10px",letterSpacing:"0.06em",marginBottom:8}}>⚡ PRE-MEETING BRIEF — ERP Rollout</div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <div style={{background:"#FEF3C7",border:"1px solid #F59E0B",borderRadius:3,padding:"7px 10px"}}>
            <div style={{fontSize:"10px",fontWeight:700,color:"#92400E",marginBottom:2}}>2 OVERDUE COMMITMENTS</div>
            <div style={{fontSize:"10px",color:"#92400E"}}>Saurabh: Vendor data sign-off (8 days ago)</div>
            <div style={{fontSize:"10px",color:"#92400E"}}>Priya: Consultant quotes (3 days ago)</div>
          </div>
          <div style={{background:"#FEE2E2",border:"1px solid #DC2626",borderRadius:3,padding:"7px 10px"}}>
            <div style={{fontSize:"10px",fontWeight:700,color:"#991B1B",marginBottom:2}}>HIGH RISK</div>
            <div style={{fontSize:"10px",color:"#991B1B"}}>Data quality not resolved → 3-week go-live slip</div>
          </div>
          <div style={{background:"#F0FDF4",border:"1px solid #16A34A",borderRadius:3,padding:"7px 10px"}}>
            <div style={{fontSize:"10px",fontWeight:700,color:"#15803D",marginBottom:2}}>LAST DECIDED</div>
            <div style={{fontSize:"10px",color:"#15803D"}}>Freeze vendor master from 15th onwards</div>
          </div>
        </div>
      </div>
    ),
  },
  {
    label: "Project Health at a Glance",
    desc: "RAG health scores, deadlines, risks, and open tasks — across all your projects on one screen.",
    color: "#059669",
    content: (
      <div style={{fontFamily:sans}}>
        <div style={{fontWeight:700,fontSize:"10px",color:muted,letterSpacing:"0.06em",marginBottom:8}}>PROJECTS</div>
        {[
          {name:"ERP Rollout – SAP S/4HANA",rag:"red",ragC:"#DC2626",notes:3,tasks:8,days:45},
          {name:"Protein Range Launch",rag:"amber",ragC:"#F59E0B",notes:2,tasks:5,days:12},
          {name:"3PM Dispatch POC",rag:"green",ragC:"#16A34A",notes:1,tasks:3,days:6},
        ].map(p=>(
          <div key={p.name} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid ${border}`}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:p.ragC,flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:"10px",fontWeight:600,color:ink,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{p.name}</div>
              <div style={{fontSize:"9px",color:muted}}>{p.notes} notes · {p.tasks} tasks open</div>
            </div>
            <div style={{fontSize:"9px",color:p.days<=14?"#DC2626":muted,fontWeight:p.days<=14?700:400,flexShrink:0}}>📅 {p.days}d</div>
          </div>
        ))}
      </div>
    ),
  },
  {
    label: "Win Today — Daily Focus",
    desc: "AI picks your 3 best bets for today. Check them off and track your streak and weekly Debrief Score.",
    color: "#D97706",
    content: (
      <div style={{fontFamily:sans}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontWeight:700,fontSize:"12px",color:ink}}>Win Today</div>
          <div style={{fontSize:"12px",fontWeight:700,color:"#D97706"}}>🔥 5</div>
        </div>
        {[
          {text:"Share vendor data sign-off template",proj:"ERP Rollout",done:true,reason:"overdue 3 days"},
          {text:"Confirm cold chain logistics partner",proj:"Protein Launch",done:true,reason:"due tomorrow"},
          {text:"Review UAT test cases with Priya",proj:"ERP Rollout",done:false,reason:"quick win"},
        ].map((t,i)=>(
          <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"6px 0",borderBottom:`1px solid ${border}`}}>
            <div style={{width:14,height:14,borderRadius:2,border:`2px solid ${t.done?"#16A34A":border}`,background:t.done?"#16A34A":"transparent",flexShrink:0,marginTop:1,display:"flex",alignItems:"center",justifyContent:"center"}}>
              {t.done&&<span style={{color:"#fff",fontSize:"9px",fontWeight:700}}>✓</span>}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:"10px",color:t.done?muted:ink,textDecoration:t.done?"line-through":"none"}}>{t.text}</div>
              <div style={{fontSize:"9px",color:muted}}>({t.reason}) · {t.proj}</div>
            </div>
          </div>
        ))}
        <div style={{marginTop:10,background:"#FEF3C7",border:"1px solid #F59E0B",borderRadius:3,padding:"6px 10px",textAlign:"center"}}>
          <div style={{fontSize:"10px",fontWeight:700,color:"#92400E"}}>Debrief Score this week: 72 ↑14</div>
        </div>
      </div>
    ),
  },
];

// ── AuthWrapper component ─────────────────────────────────────────────────────
export default function AuthWrapper({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeScreen, setActiveScreen] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Auto-advance filmstrip
  useEffect(() => {
    const t = setInterval(() => setActiveScreen(s => (s + 1) % SCREENS.length), 4000);
    return () => clearInterval(t);
  }, []);

  if (loading) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:bg,fontFamily:sans}}>
      <p style={{color:muted,fontSize:"14px"}}>Loading…</p>
    </div>
  );

  if (session) return children;

  const screen = SCREENS[activeScreen];

  return (
    <div style={{minHeight:"100vh",background:bg,fontFamily:sans,color:ink,overflowX:"hidden"}}>

      {/* Nav */}
      <nav style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 24px",borderBottom:`1px solid ${border}`,background:white,position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:3,height:20,background:accent}}/>
          <span style={{fontFamily:serif,fontSize:"18px",fontWeight:700,color:ink,letterSpacing:"-0.02em"}}>Debrief</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <a href="#features" style={{fontSize:"13px",color:muted,textDecoration:"none"}}>Features</a>
          <a href="#pricing" style={{fontSize:"13px",color:muted,textDecoration:"none"}}>Pricing</a>
          <button onClick={signIn} style={{padding:"7px 18px",background:accent,color:white,border:"none",borderRadius:3,fontSize:"13px",fontWeight:600,cursor:"pointer",fontFamily:sans}}>Sign in</button>
        </div>
      </nav>

      {/* Hero */}
      <section style={{maxWidth:1100,margin:"0 auto",padding:"64px 24px 48px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:48,alignItems:"center"}}>
        <div>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,background:accentLight,border:`1px solid ${accent}30`,borderRadius:20,padding:"4px 12px",marginBottom:20}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:"#16A34A",display:"inline-block"}}/>
            <span style={{fontSize:"11px",fontWeight:600,color:accent,letterSpacing:"0.04em"}}>MEETING INTELLIGENCE</span>
          </div>
          <h1 style={{fontFamily:serif,fontSize:"clamp(28px,4vw,46px)",fontWeight:700,lineHeight:1.15,margin:"0 0 20px",color:ink,letterSpacing:"-0.02em"}}>
            Your meetings make decisions.<br/>
            <span style={{color:accent}}>Debrief makes sure</span><br/>
            they actually happen.
          </h1>
          <p style={{fontSize:"16px",color:"#555",lineHeight:1.7,margin:"0 0 32px",maxWidth:480}}>
            Paste your meeting notes. Debrief extracts every decision, tracks every commitment, flags every risk — and briefs you before your next meeting. No bots. No integrations. Works in 5 minutes.
          </p>
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            <button onClick={signIn} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 24px",background:white,border:`1px solid ${border}`,borderRadius:3,fontSize:"14px",fontWeight:600,cursor:"pointer",fontFamily:sans,boxShadow:"0 2px 8px rgba(0,0,0,0.08)"}}>
              <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Continue with Google
            </button>
            <a href="#features" style={{padding:"12px 20px",background:"transparent",border:`1px solid ${border}`,borderRadius:3,fontSize:"14px",color:muted,cursor:"pointer",fontFamily:sans,textDecoration:"none",display:"inline-flex",alignItems:"center"}}>See how it works ↓</a>
          </div>
          <p style={{fontSize:"12px",color:muted,margin:"16px 0 0"}}>Free to start · 7-day money-back · No credit card required</p>
        </div>

        {/* Filmstrip */}
        <div>
          {/* Screen label */}
          <div style={{marginBottom:12,textAlign:"center"}}>
            <span style={{fontSize:"11px",fontWeight:700,color:screen.color,letterSpacing:"0.06em",textTransform:"uppercase"}}>{screen.label}</span>
            <p style={{margin:"4px 0 0",fontSize:"12px",color:muted,lineHeight:1.5}}>{screen.desc}</p>
          </div>
          {/* Main screen */}
          <div style={{background:white,border:`2px solid ${screen.color}30`,borderRadius:8,padding:"20px",boxShadow:"0 8px 32px rgba(0,0,0,0.08)",minHeight:220,transition:"border-color 0.3s"}}>
            {screen.content}
          </div>
          {/* Dots */}
          <div style={{display:"flex",justifyContent:"center",gap:6,marginTop:14}}>
            {SCREENS.map((_,i)=>(
              <button key={i} onClick={()=>setActiveScreen(i)} style={{width:i===activeScreen?20:6,height:6,borderRadius:3,background:i===activeScreen?accent:border,border:"none",cursor:"pointer",transition:"all 0.3s",padding:0}}/>
            ))}
          </div>
          {/* Strip thumbnails */}
          <div style={{display:"flex",gap:6,marginTop:12,overflowX:"auto",paddingBottom:4}}>
            {SCREENS.map((s,i)=>(
              <button key={i} onClick={()=>setActiveScreen(i)} style={{flexShrink:0,width:52,height:36,background:i===activeScreen?s.color:white,border:`1px solid ${i===activeScreen?s.color:border}`,borderRadius:4,cursor:"pointer",fontSize:"8px",fontWeight:700,color:i===activeScreen?white:muted,transition:"all 0.2s",padding:"0 4px",fontFamily:sans,lineHeight:1.2,textAlign:"center"}}>
                {s.label.split(" ").slice(0,2).join(" ")}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Social proof */}
      <section style={{background:white,borderTop:`1px solid ${border}`,borderBottom:`1px solid ${border}`,padding:"20px 24px",textAlign:"center"}}>
        <p style={{margin:0,fontSize:"13px",color:muted}}>
          Built for <strong style={{color:ink}}>supply chain leaders</strong> · <strong style={{color:ink}}>consultants</strong> · <strong style={{color:ink}}>operations heads</strong> · <strong style={{color:ink}}>founders</strong> who run too many meetings to remember everything
        </p>
      </section>

      {/* Features */}
      <section id="features" style={{maxWidth:1100,margin:"0 auto",padding:"64px 24px"}}>
        <div style={{textAlign:"center",marginBottom:48}}>
          <h2 style={{fontFamily:serif,fontSize:"32px",fontWeight:700,color:ink,margin:"0 0 12px",letterSpacing:"-0.02em"}}>Everything your meetings are missing</h2>
          <p style={{fontSize:"15px",color:muted,margin:0}}>Not just notes. A system for accountability.</p>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:24}}>
          {[
            {icon:"📋",title:"AI Summaries",desc:"Paste raw notes in any format. Debrief structures them into 5 clear sections — overview, decisions, actions, discussion, next steps."},
            {icon:"⚡",title:"Commitment Tracking",desc:"Every commitment extracted, assigned to a person, tracked across meetings. See reliability scores for every team member."},
            {icon:"⚠",title:"Risk Radar",desc:"AI identifies serious risks across your projects — not trivial ones. Re-evaluates after every meeting. Dismissable when resolved."},
            {icon:"🎯",title:"Pre-Meeting Brief",desc:"One click before your next meeting. Debrief surfaces what was decided last time, what's overdue, and what to watch out for."},
            {icon:"📊",title:"Project Intelligence",desc:"RAG health scores, deadline tracking, decision log, commitment history — all in one place per project."},
            {icon:"🏆",title:"Win Today + Score",desc:"AI picks your 3 best tasks for today. Track your streak and weekly Debrief Score across all dimensions of productivity."},
          ].map(f=>(
            <div key={f.title} style={{background:white,border:`1px solid ${border}`,borderRadius:6,padding:"24px",borderTop:`3px solid ${accent}`}}>
              <div style={{fontSize:"24px",marginBottom:12}}>{f.icon}</div>
              <h3 style={{fontFamily:serif,fontSize:"17px",fontWeight:700,color:ink,margin:"0 0 8px"}}>{f.title}</h3>
              <p style={{fontSize:"13px",color:"#555",lineHeight:1.6,margin:0}}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* vs competitors */}
      <section style={{background:white,borderTop:`1px solid ${border}`,borderBottom:`1px solid ${border}`,padding:"48px 24px"}}>
        <div style={{maxWidth:800,margin:"0 auto"}}>
          <h2 style={{fontFamily:serif,fontSize:"28px",fontWeight:700,color:ink,textAlign:"center",margin:"0 0 32px",letterSpacing:"-0.02em"}}>Debrief vs. everything else</h2>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
              <thead>
                <tr style={{borderBottom:`2px solid ${border}`}}>
                  {["Feature","Debrief","Fireflies / Otter","Confluence + JIRA"].map((h,i)=>(
                    <th key={h} style={{padding:"10px 16px",textAlign:i===0?"left":"center",fontWeight:700,color:i===1?accent:ink,fontFamily:i===1?serif:sans,fontSize:i===1?"15px":"13px"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Auto-extracts decisions","✓","✕","✕ (manual)"],
                  ["Tracks commitments per person","✓","✕","✕ (manual)"],
                  ["Reliability score per stakeholder","✓","✕","✕"],
                  ["Pre-meeting brief from history","✓","✕","✕"],
                  ["Project-level memory","✓","✕","✓ (manual)"],
                  ["No bot joining your calls","✓","✕","✓"],
                  ["Works in 5 minutes","✓","✓","✕ (days of setup)"],
                  ["Price per user/month","₹299–599","$10–19","$13+ combined"],
                ].map((row,i)=>(
                  <tr key={i} style={{borderBottom:`1px solid ${border}`,background:i%2===0?"#FAFAF8":white}}>
                    {row.map((cell,j)=>(
                      <td key={j} style={{padding:"10px 16px",textAlign:j===0?"left":"center",color:j===1&&cell==="✓"?"#16A34A":j===1&&cell==="✕"?"#DC2626":j>1&&cell==="✓"?"#16A34A":j>1&&cell==="✕"?"#DC2626":ink,fontWeight:j===1?700:400}}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={{maxWidth:800,margin:"0 auto",padding:"64px 24px"}}>
        <div style={{textAlign:"center",marginBottom:40}}>
          <h2 style={{fontFamily:serif,fontSize:"32px",fontWeight:700,color:ink,margin:"0 0 12px",letterSpacing:"-0.02em"}}>Simple pricing</h2>
          <p style={{fontSize:"15px",color:muted,margin:0}}>Start free. Cancel any time. 7-day money-back guarantee.</p>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:20}}>
          {[
            {region:"🇮🇳 India",price:"₹299",period:"/month",original:"₹599/month",annual:"₹2,999/year",annualOrig:"₹7,188/year",save:"58%",cta:"Get started",color:accent},
            {region:"🌍 International",price:"$9",period:"/month",original:"$19/month",annual:"$99/year",annualOrig:"$228/year",save:"57%",cta:"Get started",color:"#1D4ED8"},
          ].map(p=>(
            <div key={p.region} style={{background:white,border:`1px solid ${border}`,borderRadius:8,padding:"28px",borderTop:`3px solid ${p.color}`}}>
              <div style={{fontSize:"15px",fontWeight:700,color:ink,marginBottom:16}}>{p.region}</div>
              <div style={{display:"flex",alignItems:"baseline",gap:4,marginBottom:4}}>
                <span style={{fontFamily:serif,fontSize:"36px",fontWeight:700,color:ink}}>{p.price}</span>
                <span style={{fontSize:"13px",color:muted}}>{p.period}</span>
              </div>
              <div style={{fontSize:"12px",marginBottom:4}}><span style={{textDecoration:"line-through",color:muted}}>{p.original}</span></div>
              <div style={{background:"#F0FDF4",border:"1px solid #16A34A",borderRadius:3,padding:"4px 10px",display:"inline-flex",alignItems:"center",gap:4,marginBottom:16}}>
                <span style={{fontSize:"11px",fontWeight:700,color:"#15803D"}}>Annual: {p.annual}</span>
                <span style={{fontSize:"10px",color:"#15803D"}}>· Save {p.save}</span>
              </div>
              <div style={{fontSize:"11px",color:muted,marginBottom:16,textDecoration:"line-through"}}>{p.annualOrig}</div>
              <button onClick={signIn} style={{width:"100%",padding:"11px",background:p.color,color:white,border:"none",borderRadius:3,fontSize:"14px",fontWeight:600,cursor:"pointer",fontFamily:sans}}>
                Start free →
              </button>
              <p style={{margin:"8px 0 0",fontSize:"11px",color:muted,textAlign:"center"}}>via Gumroad · Cards · PayPal</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section style={{background:accent,padding:"64px 24px",textAlign:"center"}}>
        <h2 style={{fontFamily:serif,fontSize:"32px",fontWeight:700,color:white,margin:"0 0 16px",letterSpacing:"-0.02em"}}>Stop losing decisions in meetings.</h2>
        <p style={{fontSize:"16px",color:"rgba(255,255,255,0.8)",margin:"0 0 32px",lineHeight:1.6}}>Join professionals who use Debrief to track what was decided,<br/>who committed to what, and what to do next.</p>
        <button onClick={signIn} style={{display:"inline-flex",alignItems:"center",gap:10,padding:"14px 28px",background:white,color:accent,border:"none",borderRadius:3,fontSize:"15px",fontWeight:700,cursor:"pointer",fontFamily:sans,boxShadow:"0 4px 16px rgba(0,0,0,0.2)"}}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Start free with Google
        </button>
        <p style={{fontSize:"12px",color:"rgba(255,255,255,0.6)",margin:"16px 0 0"}}>No credit card · 7-day money-back · Cancel any time</p>
      </section>

      {/* Footer */}
      <footer style={{background:"#0A1628",padding:"24px",textAlign:"center"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:12}}>
          <div style={{width:3,height:16,background:white}}/>
          <span style={{fontFamily:serif,fontSize:"15px",fontWeight:700,color:white,letterSpacing:"-0.02em"}}>Debrief</span>
        </div>
        <div style={{fontSize:"12px",color:"rgba(255,255,255,0.4)"}}>
          <a href="/privacy.html" style={{color:"rgba(255,255,255,0.4)",marginRight:16,textDecoration:"none"}}>Privacy Policy</a>
          <a href="/terms.html" style={{color:"rgba(255,255,255,0.4)",marginRight:16,textDecoration:"none"}}>Terms of Service</a>
          <a href="/refund.html" style={{color:"rgba(255,255,255,0.4)",marginRight:16,textDecoration:"none"}}>Refund Policy</a>
          <a href="mailto:hello@getdebriefs.com" style={{color:"rgba(255,255,255,0.4)",textDecoration:"none"}}>hello@getdebriefs.com</a>
        </div>
        <p style={{margin:"12px 0 0",fontSize:"11px",color:"rgba(255,255,255,0.25)"}}>© 2026 Debrief · getdebriefs.com</p>
      </footer>
    </div>
  );
}
