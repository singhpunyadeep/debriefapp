import React, { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "./AuthWrapper.jsx";

const T = {
  bg: "#F5F4F0", white: "#FFFFFF", ink: "#1A1A1A", mid: "#6B6B6B",
  muted: "#A8A8A8", border: "#E0DFDB", accent: "#003366",
  accentLight: "#E8EEF5", accentMid: "#5580AA", danger: "#B91C1C",
  warning: "#92400E", warningLight: "#FFFBEB",
  success: "#166534", successLight: "#F0FDF4",
  serif: "Georgia, 'Times New Roman', serif",
  sans: "Inter, 'Helvetica Neue', Arial, sans-serif",
};

const PROJ_COLORS = ["#003366","#5C4033","#1A4731","#4A1942","#7C3514","#1E3A5F","#2D4A3E","#4A3728"];
const pc = i => PROJ_COLORS[i % PROJ_COLORS.length];
const avatarBg = name => { let h=0; for(const c of name) h=(h*31+c.charCodeAt(0))%PROJ_COLORS.length; return PROJ_COLORS[h]; };
const initials = n => n.trim().split(/\s+/).map(w=>w[0].toUpperCase()).slice(0,2).join("");
const fmt = iso => new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
const fmtShort = iso => new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short"});

// FIX #4: isThisWeek was broken on Sundays (getDay()=0 made week start "tomorrow").
// Now treats Sunday as day 7 so Monday is always the correct week start.
const isThisWeek = iso => {
  const d=new Date(iso), now=new Date(), s=new Date(now);
  const day = now.getDay() || 7;
  s.setDate(now.getDate()-day+1); s.setHours(0,0,0,0);
  const e=new Date(s); e.setDate(s.getDate()+6); e.setHours(23,59,59,999);
  return d>=s && d<=e;
};
const isNextWeek = iso => {
  const d=new Date(iso), now=new Date(), s=new Date(now);
  const day = now.getDay() || 7;
  s.setDate(now.getDate()-day+8); s.setHours(0,0,0,0);
  const e=new Date(s); e.setDate(s.getDate()+6); e.setHours(23,59,59,999);
  return d>=s && d<=e;
};
const isOverdue = iso => iso && new Date(iso)<new Date() && !isThisWeek(iso);

// FIX #1: claude() now checks response status and throws on failure instead of
// crashing with "cannot read .content of undefined".
const claude = async (prompt, maxTokens=1500) => {
  const r = await fetch("/api/claude", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:maxTokens,messages:[{role:"user",content:prompt}]})
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `API error ${r.status}`);
  return data.content.map(b=>b.text||"").join("");
};

const parseJsonSafe = raw => {
  try { return JSON.parse(raw.trim().replace(/^```json\s*/i,"").replace(/^```\s*/,"").replace(/```\s*$/,"").trim()); }
  catch { const m=raw.match(/[\[{][\s\S]*[\]}]/); if(m){try{return JSON.parse(m[0]);}catch{}} return null; }
};

// FIX #12: Sanitise HTML before dangerouslySetInnerHTML to prevent XSS from
// AI-generated content. Strips script/style tags and event attributes.
const sanitiseHtml = html =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi,"")
    .replace(/<style[\s\S]*?<\/style>/gi,"")
    .replace(/\son\w+="[^"]*"/gi,"")
    .replace(/\son\w+='[^']*'/gi,"")
    .replace(/javascript:/gi,"");

// ─── DB ───────────────────────────────────────────────────────────────────────
const db = {
  async getUser() { const {data:{user}}=await supabase.auth.getUser(); return user; },

  // FIX #2: loadAll now wraps each query in individual try/catch so a single
  // missing table or RLS error doesn't hang the entire app on a null data state.
  async loadAll(userId) {
    const safe = async (fn) => { try { return await fn(); } catch { return null; } };
    const [
      projects, notes, members, noteMembers,
      todos, homeSummary, profile,
      decisions, commitments, risks, qualityScores,
    ] = await Promise.all([
      safe(()=>supabase.from('projects').select('*').eq('user_id',userId).order('created_at').then(r=>r.data)),
      safe(()=>supabase.from('notes').select('*').eq('user_id',userId).order('date').then(r=>r.data)),
      safe(()=>supabase.from('members').select('*').eq('user_id',userId).order('created_at').then(r=>r.data)),
      safe(()=>supabase.from('note_members').select('*').then(r=>r.data)),
      safe(()=>supabase.from('todos').select('*').eq('user_id',userId).order('created_at').then(r=>r.data)),
      safe(()=>supabase.from('home_summaries').select('*').eq('user_id',userId).maybeSingle().then(r=>r.data)),
      safe(()=>supabase.from('profiles').select('*').eq('id',userId).single().then(r=>r.data)),
      safe(()=>supabase.from('decisions').select('*').eq('user_id',userId).order('date').then(r=>r.data)),
      safe(()=>supabase.from('commitments').select('*').eq('user_id',userId).order('date').then(r=>r.data)),
      safe(()=>supabase.from('risks').select('*').eq('user_id',userId).eq('dismissed',false).then(r=>r.data)),
      safe(()=>supabase.from('quality_scores').select('*').eq('user_id',userId).then(r=>r.data)),
    ]);
    return {
      projects: (projects||[]).map(p=>({
        ...p, statusUpdated:p.status_updated_at,
        notes:(notes||[]).filter(n=>n.project_id===p.id).map(n=>({
          ...n, selfTagged:n.self_tagged,
          taggedMembers:(noteMembers||[]).filter(nm=>nm.note_id===n.id).map(nm=>nm.member_id),
          qualityScore:(qualityScores||[]).find(q=>q.note_id===n.id)||null,
        })),
        decisions:(decisions||[]).filter(d=>d.project_id===p.id),
        commitments:(commitments||[]).filter(c=>c.project_id===p.id),
        risks:(risks||[]).filter(r=>r.project_id===p.id),
      })),
      members:members||[],
      todos:(todos||[]).map(t=>({...t,dueDate:t.due_date,projectId:t.project_id,doneAt:t.done_at,memberId:t.member_id})),
      risks:risks||[],
      me:profile?.name||null, tourDone:profile?.tour_done||false,
      homeWeeklySummary:homeSummary?.summary||null, homeWeeklySummaryDate:homeSummary?.updated_at||null,
    };
  },

  async createProject(userId,name) {
    const {data}=await supabase.from('projects').insert({user_id:userId,name}).select().single();
    return {...data,notes:[],decisions:[],commitments:[],risks:[],status:null,statusUpdated:null};
  },
  async updateProjectStatus(projectId,status) {
    await supabase.from('projects').update({status,status_updated_at:new Date().toISOString()}).eq('id',projectId);
  },

  // FIX #3: deleteProject now explicitly deletes all child records before
  // deleting the project itself, to avoid orphaned rows if ON DELETE CASCADE
  // is not set in the Supabase schema.
  async deleteProject(projectId) {
    await Promise.all([
      supabase.from('risks').delete().eq('project_id',projectId),
      supabase.from('commitments').delete().eq('project_id',projectId),
      supabase.from('decisions').delete().eq('project_id',projectId),
      supabase.from('todos').update({project_id:null}).eq('project_id',projectId),
    ]);
    // Delete note_members for notes belonging to this project
    const {data:projectNotes}=await supabase.from('notes').select('id').eq('project_id',projectId);
    if(projectNotes?.length>0){
      const noteIds=projectNotes.map(n=>n.id);
      await supabase.from('quality_scores').delete().in('note_id',noteIds);
      await supabase.from('note_members').delete().in('note_id',noteIds);
    }
    await supabase.from('notes').delete().eq('project_id',projectId);
    await supabase.from('projects').delete().eq('id',projectId);
  },

  async createNote(userId,projectId,{raw,summary,selfTagged,taggedMemberIds}) {
    const {data:note}=await supabase.from('notes').insert({user_id:userId,project_id:projectId,raw,summary,self_tagged:selfTagged,date:new Date().toISOString()}).select().single();
    if(taggedMemberIds?.length>0) await supabase.from('note_members').insert(taggedMemberIds.map(member_id=>({note_id:note.id,member_id})));
    return {...note,selfTagged:note.self_tagged,taggedMembers:taggedMemberIds||[]};
  },
  async updateNote(noteId,{raw,summary}) { await supabase.from('notes').update({raw,summary}).eq('id',noteId); },
  async deleteNote(noteId) {
    await supabase.from('quality_scores').delete().eq('note_id',noteId);
    await supabase.from('note_members').delete().eq('note_id',noteId);
    await supabase.from('notes').delete().eq('id',noteId);
  },

  async saveDecisions(userId,projectId,noteId,decisions) {
    if(!decisions?.length) return;
    await supabase.from('decisions').insert(decisions.map(d=>({user_id:userId,project_id:projectId,note_id:noteId,decision_text:d.decision,context:d.context,date:new Date().toISOString()})));
  },
  async saveCommitments(userId,projectId,noteId,commitments,members) {
    if(!commitments?.length) return;
    await supabase.from('commitments').insert(commitments.map(c=>{
      const member=members.find(m=>m.name.toLowerCase()===c.person?.toLowerCase());
      return {user_id:userId,project_id:projectId,note_id:noteId,commitment_text:c.commitment,member_id:member?.id||null,status:'open',date:new Date().toISOString()};
    }));
  },
  async updateCommitmentStatus(commitmentId,status) {
    await supabase.from('commitments').update({status}).eq('id',commitmentId);
  },
  async saveQualityScore(userId,noteId,{score,feedback,breakdown}) {
    await supabase.from('quality_scores').upsert({user_id:userId,note_id:noteId,score,feedback,breakdown});
  },
  async saveRisks(userId,projectId,risks) {
    if(!risks?.length) return;
    await supabase.from('risks').insert(risks.map(r=>({user_id:userId,project_id:projectId,risk_text:r.text,severity:r.severity||'medium',dismissed:false,detected_at:new Date().toISOString()})));
  },
  async dismissRisk(riskId) { await supabase.from('risks').update({dismissed:true}).eq('id',riskId); },

  async createMember(userId,{name,role}) {
    const {data}=await supabase.from('members').insert({user_id:userId,name,role}).select().single(); return data;
  },
  async updateMemberSummary(memberId,summary) {
    await supabase.from('members').update({summary,summary_updated_at:new Date().toISOString()}).eq('id',memberId);
  },
  async updateMemberIntelligence(memberId,intelligence) {
    await supabase.from('members').update({intelligence,intelligence_updated_at:new Date().toISOString()}).eq('id',memberId);
  },
  async deleteMember(memberId) { await supabase.from('members').delete().eq('id',memberId); },

  async createTodo(userId,{text,dueDate,projectId,source='manual',memberId}) {
    const {data}=await supabase.from('todos').insert({user_id:userId,text,due_date:dueDate||null,project_id:projectId||null,source,member_id:memberId||null}).select().single();
    return {...data,dueDate:data.due_date,projectId:data.project_id,memberId:data.member_id};
  },
  async toggleTodo(todoId,done) { await supabase.from('todos').update({done,done_at:done?new Date().toISOString():null}).eq('id',todoId); },
  async deleteTodo(todoId) { await supabase.from('todos').delete().eq('id',todoId); },
  async upsertHomeSummary(userId,summary) { await supabase.from('home_summaries').upsert({user_id:userId,summary,updated_at:new Date().toISOString()}); },
  async setName(userId,name) { await supabase.from('profiles').upsert({id:userId,name}); },
  async completeTour(userId) { await supabase.from('profiles').update({tour_done:true}).eq('id',userId); },
};

// ─── UI Primitives ────────────────────────────────────────────────────────────

// FIX #12: MD renderer now sanitises output before setting innerHTML.
const MD = ({content,small}) => {
  const fs=small?"13px":"14px";
  const css=`.md h1{font-size:17px;font-weight:700;margin:12px 0 5px;font-family:${T.serif};color:${T.ink};text-align:left}.md h2{font-size:15px;font-weight:700;margin:10px 0 4px;font-family:${T.serif};color:${T.ink};text-align:left}.md h3{font-size:14px;font-weight:600;margin:8px 0 3px;color:${T.ink};text-align:left}.md strong{font-weight:600}.md ul,.md ol{margin:4px 0;padding-left:18px;text-align:left}.md li{margin:2px 0;font-size:${fs};text-align:left}.md ul li{list-style-type:disc}.md ol li{list-style-type:decimal}.md p{margin:4px 0;font-size:${fs};line-height:1.6;text-align:left;color:${T.ink}}`;
  const render=t=>{
    let h=t.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/^### (.+)$/gm,"<h3>$1</h3>").replace(/^## (.+)$/gm,"<h2>$1</h2>").replace(/^# (.+)$/gm,"<h1>$1</h1>");
    const lines=h.split("\n"),out=[],stk=[];
    for(const line of lines){
      const bm=line.match(/^(\s*)[-*+•] (.+)$/),nm=line.match(/^(\s*)\d+\.\s(.+)$/);
      if(bm||nm){const m=bm||nm,lvl=Math.floor(m[1].length/2),lt=bm?"ul":"ol";while(stk.length>lvl+1)out.push(`</${stk.pop()}>`);if(stk.length===lvl){out.push(`<${lt}>`);stk.push(lt);}out.push(`<li>${m[2]}</li>`);}
      else{while(stk.length)out.push(`</${stk.pop()}>`);out.push(line.trim()===""?"<br/>":line.match(/^<[^>]+>$/)?line:`<p>${line}</p>`);}
    }
    while(stk.length)out.push(`</${stk.pop()}>`); return sanitiseHtml(out.join(""));
  };
  return <><style>{css}</style><div className="md" dangerouslySetInnerHTML={{__html:render(content)}}/></>;
};

const Av = ({name,size=28,isSelf=false}) => (
  <div style={{width:size,height:size,borderRadius:"50%",background:isSelf?T.accent:avatarBg(name),color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:Math.floor(size*0.36),fontWeight:700,flexShrink:0}}>{initials(name)}</div>
);

const Btn = ({children,onClick,disabled,variant="primary",size="md"}) => {
  const pad=size==="sm"?"5px 10px":"9px 16px",fs=size==="sm"?"12px":"13px";
  const v={primary:{background:T.accent,color:"#fff",border:`1px solid ${T.accent}`},secondary:{background:"transparent",color:T.ink,border:`1px solid ${T.border}`},ghost:{background:"transparent",color:T.mid,border:"none"},danger:{background:"transparent",color:T.danger,border:`1px solid ${T.danger}`}};
  return <button onClick={onClick} disabled={disabled} style={{...v[variant],padding:pad,fontSize:fs,fontWeight:500,cursor:disabled?"not-allowed":"pointer",borderRadius:2,fontFamily:T.sans,opacity:disabled?0.5:1,whiteSpace:"nowrap",flexShrink:0}}>{children}</button>;
};

const Tag = ({color,children,onClick}) => (
  <span onClick={onClick} style={{display:"inline-flex",alignItems:"center",gap:3,background:color+"14",color,border:`1px solid ${color}30`,borderRadius:2,padding:"2px 6px",fontSize:"11px",fontWeight:600,letterSpacing:"0.03em",textTransform:"uppercase",cursor:onClick?"pointer":"default",whiteSpace:"nowrap",flexShrink:0}}>{children}</span>
);

const Card = ({children,accent,style={}}) => (
  <div style={{background:T.white,border:`1px solid ${T.border}`,borderLeft:accent?`3px solid ${accent}`:`1px solid ${T.border}`,padding:"16px 18px",marginBottom:10,fontFamily:T.sans,boxSizing:"border-box",...style}}>{children}</div>
);

const Label = ({children}) => (
  <p style={{margin:"0 0 5px",fontSize:"11px",fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:T.mid}}>{children}</p>
);

const inp = {width:"100%",padding:"9px 11px",border:`1px solid ${T.border}`,borderRadius:2,fontSize:"14px",color:T.ink,boxSizing:"border-box",fontFamily:T.sans,background:T.white,outline:"none"};

const Shell = ({children,maxW=820}) => (
  <div style={{fontFamily:T.sans,minHeight:"100vh",backgroundColor:T.bg,color:T.ink,boxSizing:"border-box",overflowX:"hidden"}}>
    <div style={{maxWidth:maxW,margin:"0 auto",padding:"28px 16px 80px",boxSizing:"border-box"}}>{children}</div>
  </div>
);

const GroupLabel = ({children,color=T.mid}) => (
  <p style={{margin:"14px 0 6px",fontSize:"10px",fontWeight:700,letterSpacing:"0.09em",textTransform:"uppercase",color}}>{children}</p>
);

const Logo = () => (
  <div style={{display:"flex",alignItems:"center",gap:7}}>
    <div style={{width:3,height:20,background:T.accent}}/>
    <span style={{fontFamily:T.serif,fontSize:"16px",fontWeight:700,color:T.ink,letterSpacing:"-0.02em"}}>Debrief</span>
  </div>
);

const SeverityBadge = ({severity}) => {
  const colors={high:T.danger,medium:T.warning,low:T.accentMid};
  const c=colors[severity]||T.muted;
  return <span style={{background:c+"14",color:c,border:`1px solid ${c}30`,borderRadius:2,padding:"2px 6px",fontSize:"10px",fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase"}}>{severity}</span>;
};

const ScoreBadge = ({score}) => {
  const c=score>=8?T.success:score>=5?T.warning:T.danger;
  return <span style={{background:c+"14",color:c,border:`1px solid ${c}30`,borderRadius:2,padding:"2px 8px",fontSize:"12px",fontWeight:700}}>{score}/10</span>;
};

// FIX #10: Toast component replaces alert() for clipboard feedback.
const Toast = ({message,onDone}) => {
  useEffect(()=>{const t=setTimeout(onDone,2200);return()=>clearTimeout(t);},[]);
  return (
    <div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",background:T.ink,color:"#fff",padding:"9px 18px",borderRadius:4,fontSize:"13px",fontFamily:T.sans,zIndex:2000,whiteSpace:"nowrap",boxShadow:"0 4px 16px rgba(0,0,0,0.18)"}}>
      {message}
    </div>
  );
};

// ─── Bottom Search / Ask Bar ───────────────────────────────────────────────────
const BottomSearchBar = ({onClick}) => (
  <div style={{position:"fixed",bottom:16,left:"50%",transform:"translateX(-50%)",zIndex:900,width:"calc(100% - 32px)",maxWidth:500}}>
    <button onClick={onClick} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"11px 18px",background:T.white,border:`1px solid ${T.border}`,borderRadius:24,boxShadow:"0 2px 16px rgba(0,0,0,0.08)",cursor:"pointer",fontFamily:T.sans,color:T.muted,fontSize:"13px"}}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{flexShrink:0}}><circle cx="6" cy="6" r="4.5" stroke={T.muted} strokeWidth="1.5"/><path d="M9.5 9.5L12 12" stroke={T.muted} strokeWidth="1.5" strokeLinecap="round"/></svg>
      Search or ask anything about your notes…
      <span style={{marginLeft:"auto",fontSize:"11px",color:T.border}}>⌘K</span>
    </button>
  </div>
);

// ─── Search + Ask Overlay ─────────────────────────────────────────────────────
const SearchAskOverlay = ({projects,members,todos,onClose,onProjectNav}) => {
  const [q,setQ]=useState("");
  const [mode,setMode]=useState("search");
  const [askAnswer,setAskAnswer]=useState("");
  const [asking,setAsking]=useState(false);
  const inputRef=useRef(null);
  useEffect(()=>{ setTimeout(()=>inputRef.current?.focus(),50); },[]);

  const isQuestion = q.trim().endsWith("?")||/^(what|who|when|why|how|which|did|has|show)\b/i.test(q.trim());

  const results=useMemo(()=>{
    if(!q.trim()||mode==="ask") return [];
    const ql=q.toLowerCase(),hits=[];
    for(const p of projects){
      for(const n of p.notes){
        if(n.summary?.toLowerCase().includes(ql)||n.raw?.toLowerCase().includes(ql)||p.name.toLowerCase().includes(ql))
          hits.push({note:n,project:p,projIdx:projects.findIndex(pp=>pp.id===p.id)});
      }
    }
    return hits.slice(0,15);
  },[q,projects,mode]);

  const highlight=(text,q)=>{
    if(!q.trim()) return text.slice(0,120);
    const idx=text.toLowerCase().indexOf(q.toLowerCase());
    if(idx===-1) return text.slice(0,120);
    const start=Math.max(0,idx-40);
    return (start>0?"…":"")+text.slice(start,start+160)+(start+160<text.length?"…":"");
  };

  const handleAsk=async()=>{
    if(!q.trim()) return;
    setAsking(true);setAskAnswer("");setMode("ask");
    try{
      const allNotes=projects.flatMap(p=>p.notes.map(n=>(`[${p.name}] ${fmt(n.date)}:\n${n.summary}`)));
      const allDecisions=projects.flatMap(p=>(p.decisions||[]).map(d=>(`[${p.name}] Decision: ${d.decision_text}`)));
      const allCommitments=projects.flatMap(p=>(p.commitments||[]).map(c=>(`[${p.name}] Commitment by ${members.find(m=>m.id===c.member_id)?.name||"someone"}: ${c.commitment_text} (${c.status})`)));
      const allTasks=todos.map(t=>{const p=projects.find(pp=>pp.id===t.projectId);return `[${p?.name||"No project"}] Task: ${t.text} (${t.done?"done":"pending"})`;});
      const context=[...allNotes,...allDecisions,...allCommitments,...allTasks].join("\n\n");
      const answer=await claude(`You are a helpful assistant with access to all the user's meeting notes, decisions, commitments and tasks. Answer the question directly and specifically using the information below. If you can't find the answer, say so clearly.\n\nQuestion: ${q}\n\nContext:\n${context}`,800);
      setAskAnswer(answer);
    }catch{setAskAnswer("Sorry, couldn't get an answer. Please try again.");}
    finally{setAsking(false);}
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",flexDirection:"column"}} onClick={onClose}>
      <div style={{background:T.white,margin:"20px 16px 0",borderRadius:4,padding:"12px 16px",display:"flex",gap:10,alignItems:"center"}} onClick={e=>e.stopPropagation()}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke={T.muted} strokeWidth="1.5"/><path d="M9.5 9.5L12 12" stroke={T.muted} strokeWidth="1.5" strokeLinecap="round"/></svg>
        <input ref={inputRef} value={q} onChange={e=>{setQ(e.target.value);setMode("search");setAskAnswer("");}}
          onKeyDown={e=>e.key==="Enter"&&isQuestion&&handleAsk()}
          placeholder="Search or ask: 'Who owns the API task?' or 'What did we decide about pricing?'"
          style={{flex:1,border:"none",outline:"none",fontSize:"14px",color:T.ink,fontFamily:T.sans,background:"transparent"}}/>
        {isQuestion&&q.trim()&&<button onClick={handleAsk} disabled={asking} style={{padding:"4px 12px",fontSize:"12px",background:T.accent,color:"#fff",border:"none",borderRadius:2,cursor:"pointer",flexShrink:0,fontFamily:T.sans}}>{asking?"Asking…":"Ask AI"}</button>}
        <button onClick={onClose} style={{background:"none",border:"none",color:T.muted,fontSize:18,cursor:"pointer",padding:0}}>✕</button>
      </div>
      <div style={{flex:1,overflowY:"auto",margin:"8px 16px 16px"}} onClick={e=>e.stopPropagation()}>
        {mode==="ask"&&(
          <div style={{background:T.white,borderRadius:4,padding:"16px"}}>
            <p style={{margin:"0 0 8px",fontSize:"11px",fontWeight:700,letterSpacing:"0.06em",color:T.muted,textTransform:"uppercase"}}>AI Answer</p>
            {asking?<p style={{color:T.mid,fontSize:"14px"}}>Searching your notes…</p>:<MD content={askAnswer} small/>}
          </div>
        )}
        {mode==="search"&&results.map((r,i)=>(
          <div key={i} onClick={()=>{onProjectNav(r.projIdx);onClose();}} style={{background:T.white,borderRadius:4,padding:"14px 16px",marginBottom:6,cursor:"pointer",borderLeft:`3px solid ${pc(r.projIdx)}`}}>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}>
              <Tag color={pc(r.projIdx)}>{r.project.name}</Tag>
              <span style={{fontSize:"11px",color:T.muted}}>{fmt(r.note.date)}</span>
            </div>
            <p style={{margin:0,fontSize:"13px",color:T.mid,lineHeight:1.5,textAlign:"left"}}>{highlight(r.note.summary?.replace(/[#*]/g,"")||r.note.raw||"",q)}</p>
          </div>
        ))}
        {mode==="search"&&q.trim()&&results.length===0&&<div style={{background:T.white,borderRadius:4,padding:"24px",textAlign:"center",color:T.muted,fontSize:"14px"}}>No results. Try asking a question — type "?" at the end.</div>}
        {!q.trim()&&<div style={{background:T.white,borderRadius:4,padding:"20px 16px"}}>
          <p style={{margin:"0 0 12px",fontSize:"11px",fontWeight:700,letterSpacing:"0.06em",color:T.muted,textTransform:"uppercase"}}>Try asking</p>
          {["Who owns the API integration task?","What did we decide about pricing?","Which projects have overdue items?","What has Sarah committed to?","Show me all risks across projects"].map((s,i)=>(
            <button key={i} onClick={()=>{setQ(s);setTimeout(()=>handleAsk(),100);}} style={{display:"block",width:"100%",textAlign:"left",padding:"8px 0",fontSize:"13px",color:T.accentMid,background:"none",border:"none",borderBottom:`1px solid ${T.border}`,cursor:"pointer",fontFamily:T.sans}}>
              {s}
            </button>
          ))}
        </div>}
      </div>
    </div>
  );
};

// ─── Edit Note Modal ──────────────────────────────────────────────────────────
const EditNoteModal = ({note,projectName,onSave,onCancel,saving}) => {
  const ref=useRef(null);
  useEffect(()=>{ if(ref.current) ref.current.value=note.raw; },[]);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:T.white,borderRadius:4,padding:"24px",width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",fontFamily:T.sans}}>
        <h2 style={{margin:"0 0 4px",fontSize:"18px",fontWeight:700,fontFamily:T.serif,color:T.ink}}>Edit Meeting Notes</h2>
        <p style={{margin:"0 0 14px",fontSize:"12px",color:T.muted}}>Saving to: {projectName} · Summary will be regenerated</p>
        <textarea ref={ref} style={{...inp,height:220,resize:"vertical",lineHeight:1.65}}/>
        {saving&&<p style={{fontSize:"12px",color:T.accentMid,margin:"8px 0 0"}}>Regenerating summary and project status…</p>}
        <div style={{display:"flex",gap:8,marginTop:14}}>
          <Btn onClick={()=>onSave(ref.current?.value||"")} disabled={saving}>{saving?"Saving…":"Save & Regenerate"}</Btn>
          <Btn variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Btn>
        </div>
      </div>
    </div>
  );
};

// ─── Tour ─────────────────────────────────────────────────────────────────────
const TOUR_STEPS=[
  {target:"tour-briefing",title:"Your command centre",body:"Every week, Debrief reads all your meeting notes and tasks, then writes you a smart briefing — what got done, what's still open, and what to prioritise next week."},
  {target:"tour-tasks",title:"Never miss an action item",body:"Tag yourself with @YourName inside meeting notes. Debrief automatically extracts every action item assigned to you and adds it here."},
  {target:"tour-project",title:"Organise by project",body:"Create a project for each client, team, or initiative. Debrief tracks decisions, commitments, risks and tasks — all in one place."},
  {target:"tour-nav",title:"Track your whole team",body:"Go to Team to add colleagues. Tag them in notes and Debrief builds an intelligence profile on each person across all projects."},
];

// FIX #11: Tour tooltip now uses position:fixed consistently on desktop so it
// doesn't mix absolute/fixed coordinate systems. On mobile it uses a bottom sheet
// (unchanged). The desktop variant calculates viewport position correctly.
const Tour=({onDone})=>{
  const [step,setStep]=useState(0);
  const [pos,setPos]=useState(null);
  const isMobile=window.innerWidth<600;

  useEffect(()=>{
    const position=()=>{
      const el=document.getElementById(TOUR_STEPS[step].target);
      if(!el)return;
      const r=el.getBoundingClientRect();
      // Use viewport coords for position:fixed (no scrollY offset needed)
      setPos({top:r.bottom+10, left:Math.min(r.left, window.innerWidth-280)});
    };
    position();
    window.addEventListener('resize',position);
    window.addEventListener('scroll',position,true);
    return()=>{window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);};
  },[step]);

  const next=()=>{if(step<TOUR_STEPS.length-1)setStep(s=>s+1);else onDone();};
  const prev=()=>{if(step>0)setStep(s=>s-1);};
  const curr=TOUR_STEPS[step];

  if(isMobile) return (
    <>
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:999}} onClick={onDone}/>
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",padding:"24px 20px 36px",zIndex:1000,fontFamily:T.sans}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <span style={{fontSize:"11px",fontWeight:700,letterSpacing:"0.07em",color:T.muted,textTransform:"uppercase"}}>Step {step+1} of {TOUR_STEPS.length}</span>
          <button onClick={onDone} style={{background:"none",border:"none",color:T.muted,fontSize:18,cursor:"pointer",padding:0}}>✕</button>
        </div>
        <h3 style={{margin:"0 0 8px",fontSize:"18px",fontWeight:700,fontFamily:T.serif,color:T.ink,textAlign:"left"}}>{curr.title}</h3>
        <p style={{margin:"0 0 20px",fontSize:"14px",color:T.mid,lineHeight:1.6,textAlign:"left"}}>{curr.body}</p>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",gap:5}}>{TOUR_STEPS.map((_,i)=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:i===step?T.accent:T.border}}/>)}</div>
          <div style={{display:"flex",gap:8}}>
            {step>0&&<button onClick={prev} style={{padding:"8px 16px",fontSize:"13px",border:`1px solid ${T.border}`,borderRadius:4,background:"transparent",color:T.ink,cursor:"pointer"}}>← Back</button>}
            <button onClick={next} style={{padding:"8px 20px",fontSize:"13px",border:"none",borderRadius:4,background:T.accent,color:"#fff",fontWeight:600,cursor:"pointer"}}>{step===TOUR_STEPS.length-1?"Got it ✓":"Next →"}</button>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.25)",zIndex:999}} onClick={onDone}/>
      {pos&&<div style={{position:"fixed",top:pos.top,left:pos.left,width:260,background:T.accent,color:"#fff",borderRadius:8,padding:"14px 16px",zIndex:1000,fontFamily:T.sans,boxSizing:"border-box"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
          <span style={{fontSize:"13px",fontWeight:700}}>{curr.title}</span>
          <button onClick={onDone} style={{background:"none",border:"none",color:"rgba(255,255,255,0.6)",fontSize:14,cursor:"pointer",padding:0,marginLeft:8,flexShrink:0}}>✕</button>
        </div>
        <p style={{margin:"0 0 14px",fontSize:"13px",lineHeight:1.6,color:"rgba(255,255,255,0.85)",textAlign:"left"}}>{curr.body}</p>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",gap:4}}>{TOUR_STEPS.map((_,i)=><div key={i} style={{width:5,height:5,borderRadius:"50%",background:i===step?"#fff":"rgba(255,255,255,0.35)"}}/>)}</div>
          <div style={{display:"flex",gap:6}}>
            {step>0&&<button onClick={prev} style={{padding:"4px 10px",fontSize:"11px",border:"1px solid rgba(255,255,255,0.3)",borderRadius:3,background:"transparent",color:"#fff",cursor:"pointer"}}>← Back</button>}
            <button onClick={next} style={{padding:"4px 12px",fontSize:"11px",border:"none",borderRadius:3,background:"rgba(255,255,255,0.2)",color:"#fff",fontWeight:600,cursor:"pointer"}}>{step===TOUR_STEPS.length-1?"Got it ✓":"Next →"}</button>
          </div>
        </div>
        <div style={{position:"absolute",top:-6,left:16,width:0,height:0,borderLeft:"6px solid transparent",borderRight:"6px solid transparent",borderBottom:`6px solid ${T.accent}`}}/>
      </div>}
    </>
  );
};

// ─── Note Textarea ────────────────────────────────────────────────────────────
const NoteTextarea=({onSubmit,onCancel,loading,error,projectName,meName,members})=>{
  const ref=useRef(null);
  const [show,setShow]=useState(false);
  const [q,setQ]=useState("");
  const [dropPos,setDropPos]=useState(0);
  const all=useMemo(()=>[{id:"me",name:meName,isSelf:true},...members.map(m=>({...m,isSelf:false}))],[meName,members]);
  const filtered=all.filter(m=>m.name.toLowerCase().includes(q.toLowerCase()));
  const handleChange=e=>{const val=e.target.value,cur=e.target.selectionStart,before=val.slice(0,cur);const match=before.match(/@([\w][\w ]*)$/);if(match){setQ(match[1]);setShow(true);setDropPos(cur-match[0].length);}else setShow(false);};
  const insert=name=>{const ta=ref.current,val=ta.value,before=val.slice(0,dropPos),rest=val.slice(dropPos).replace(/^@[\w ]*/,"");ta.value=before+`@${name}`+(rest.startsWith(" ")?rest:" "+rest);setShow(false);ta.focus();};
  const loadExample=key=>{ref.current.value=key==="meetingNotes"?`Product Planning - Jan 15\nAttendees: Sarah (PM), Mike (Eng), Alex\n- Prioritize mobile app\n- Analytics dashboard to Q2\n- Decision: Push v2 launch to March\nActions: @${meName} review dashboard spec by Jan 20, Sarah finalize roadmap`:`[00:00] Standup. Sarah - dashboard?\n[00:25] Sarah: Auth done, 80% reporting. Ready Thursday.\n[00:45] Blocker: charts broken dark mode.\n[01:00] Mike: I'll help.\n[01:25] @${meName} to send sprint summary by EOD.`;};
  return (
    <Card>
      <div style={{marginBottom:14}}>
        <h2 style={{margin:0,fontSize:"18px",fontWeight:700,fontFamily:T.serif,color:T.ink}}>Add Meeting Notes</h2>
        <p style={{margin:"2px 0 0",fontSize:"12px",color:T.muted}}>Saving to: {projectName}</p>
      </div>
      <p style={{fontSize:"12px",color:T.muted,margin:"0 0 8px"}}>Type @ to tag people. Decisions, commitments and risks will be auto-extracted.</p>
      <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
        {["meetingNotes","transcripts"].map(k=>(
          <button key={k} onClick={()=>loadExample(k)} style={{padding:"3px 10px",fontSize:"11px",border:`1px solid ${T.border}`,borderRadius:2,background:"transparent",color:T.mid,cursor:"pointer",fontFamily:T.sans}}>{k==="meetingNotes"?"Meeting notes":"Transcript"}</button>
        ))}
      </div>
      <div style={{position:"relative"}}>
        <textarea ref={ref} onChange={handleChange} placeholder="Paste raw notes, transcript, or bullets…" style={{...inp,height:180,resize:"vertical",lineHeight:1.65}}/>
        {show&&filtered.length>0&&(
          <div style={{position:"absolute",top:"100%",left:0,right:0,background:T.white,border:`1px solid ${T.border}`,borderRadius:2,boxShadow:"0 4px 12px rgba(0,0,0,0.08)",zIndex:20}}>
            {filtered.map(m=>(
              <div key={m.id} onMouseDown={e=>{e.preventDefault();insert(m.name);}} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",cursor:"pointer",fontSize:"13px",color:T.ink,borderBottom:`1px solid ${T.border}`}}>
                <Av name={m.name} size={20} isSelf={m.isSelf}/>{m.name}{m.isSelf&&" (you)"}
              </div>
            ))}
          </div>
        )}
      </div>
      {error&&<p style={{color:T.danger,fontSize:"12px",margin:"6px 0 0"}}>{error}</p>}
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <Btn onClick={()=>onSubmit(ref.current?.value||"")} disabled={loading}>{loading?"Analysing…":"Analyse & Save"}</Btn>
        <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
      </div>
    </Card>
  );
};

// ─── Todo Item ────────────────────────────────────────────────────────────────
const TodoItem=({todo,projects,members,onToggle,onDelete,onProjectNav})=>{
  const proj=todo.projectId?projects.find(p=>p.id===todo.projectId):null;
  const projIdx=proj?projects.findIndex(p=>p.id===todo.projectId):-1;
  const assignedMember=todo.memberId?members.find(m=>m.id===todo.memberId):null;
  const overdue=!todo.done&&isOverdue(todo.dueDate);
  return (
    <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 0",borderBottom:`1px solid ${T.border}`}}>
      <input type="checkbox" checked={!!todo.done} onChange={()=>onToggle(todo.id)} style={{marginTop:3,accentColor:T.accent,cursor:"pointer",flexShrink:0}}/>
      <div style={{flex:1,minWidth:0}}>
        <p style={{margin:0,fontSize:"13px",color:T.ink,textDecoration:todo.done?"line-through":"none",lineHeight:1.5,wordBreak:"break-word"}}>{todo.text}</p>
        <div style={{display:"flex",gap:5,marginTop:3,flexWrap:"wrap",alignItems:"center"}}>
          {proj&&<Tag color={pc(projIdx)} onClick={()=>onProjectNav&&onProjectNav(projIdx)}>{proj.name}</Tag>}
          {assignedMember&&<Tag color={avatarBg(assignedMember.name)}>{assignedMember.name}</Tag>}
          {todo.dueDate&&<span style={{fontSize:"11px",color:overdue?T.danger:T.muted,fontWeight:overdue?600:400}}>{overdue?"Overdue · ":""}{fmtShort(todo.dueDate)}</span>}
          {todo.source==="ai"&&<span style={{fontSize:"10px",color:T.muted,letterSpacing:"0.05em"}}>AUTO</span>}
        </div>
      </div>
      <button onClick={()=>onDelete(todo.id)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:14,padding:"0 2px",flexShrink:0}}>✕</button>
    </div>
  );
};

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [userId,setUserId]=useState(null);
  const [data,setData]=useState(null);
  const [showTour,setShowTour]=useState(false);
  const [showSearch,setShowSearch]=useState(false);
  const [editingNote,setEditingNote]=useState(null);
  const [editSaving,setEditSaving]=useState(false);
  const [view,setView]=useState("home");
  const [activeIdx,setActiveIdx]=useState(null);
  const [activeMemberId,setActiveMemberId]=useState(null);
  const [loading,setLoading]=useState(false);
  const [homeLoading,setHomeLoading]=useState(false);
  const [memberLoading,setMemberLoading]=useState(false);
  const [error,setError]=useState("");
  const [expandedNote,setExpandedNote]=useState(null);
  const [newProjName,setNewProjName]=useState("");
  const [newMemberName,setNewMemberName]=useState("");
  const [newMemberRole,setNewMemberRole]=useState("");
  const [meName,setMeName]=useState("");
  const [notes,setNotes]=useState("");
  const [taggedSelf,setTaggedSelf]=useState(false);
  const [taggedMembers,setTaggedMembers]=useState([]);
  const [questions,setQuestions]=useState([]);
  const [answers,setAnswers]=useState({});
  const [notePhase,setNotePhase]=useState("input");
  const [newTodoText,setNewTodoText]=useState("");
  const [newTodoDue,setNewTodoDue]=useState("");
  const [newTodoProjectId,setNewTodoProjectId]=useState("");
  const [newTodoMemberId,setNewTodoMemberId]=useState("");
  const [todoFilter,setTodoFilter]=useState("pending");
  const [activeProjectTab,setActiveProjectTab]=useState("notes");
  // FIX #10: toast state replaces alert()
  const [toast,setToast]=useState(null);

  // Store tagged members in a ref so the clarifying-phase finalise
  // always gets the correct value even across async boundaries (FIX #6 hardening)
  const taggedMembersRef=useRef([]);
  const taggedSelfRef=useRef(false);

  useEffect(()=>{
    db.getUser().then(user=>{
      if(user){setUserId(user.id);db.loadAll(user.id).then(d=>{setData(d);if(d.me)setMeName(d.me);if(d.me&&!d.tourDone)setShowTour(true);});}
    });
  },[]);

  useEffect(()=>{
    const handler=e=>{if(e.key==="k"&&(e.metaKey||e.ctrlKey)){e.preventDefault();setShowSearch(s=>!s);}};
    window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler);
  },[]);

  const projects=data?.projects||[];
  const members=data?.members||[];
  const todos=data?.todos||[];
  const allRisks=data?.risks||[];
  const activeProject=activeIdx!==null?projects[activeIdx]:null;
  const activeMember=activeMemberId?members.find(m=>m.id===activeMemberId):null;
  const undismissedRisks=allRisks.filter(r=>!r.dismissed);

  const reload=async()=>{if(!userId)return null;const d=await db.loadAll(userId);setData(d);return d;};
  const meInNotes=text=>data?.me&&text.toLowerCase().includes(data.me.toLowerCase());
  const extractMentions=text=>members.filter(m=>text.toLowerCase().includes(m.name.toLowerCase())||text.includes(`@${m.name}`));

  const saveMe=async()=>{if(!meName.trim()||!userId)return;await db.setName(userId,meName.trim());setData(d=>({...d,me:meName.trim()}));setShowTour(true);};
  const handleTourDone=async()=>{setShowTour(false);if(userId)await db.completeTour(userId);};
  const signOut=async()=>{await supabase.auth.signOut();window.location.reload();};

  // ── AI extraction pipeline ──────────────────────────────────────────────────
  const extractIntelligence=async(summary,noteId,projectId,projName,existingNotes)=>{
    try{
      const priorContext=existingNotes.slice(-5).map(n=>n.summary).join("\n\n");
      const raw=await claude(`Analyse this meeting summary and extract structured intelligence. Return ONLY valid JSON, no other text.

{
  "decisions": [{"decision": "what was decided", "context": "why or by whom"}],
  "commitments": [{"person": "name or 'unclear'", "commitment": "what they committed to"}],
  "risks": [{"text": "risk description", "severity": "high|medium|low"}],
  "quality": {"score": 1-10, "feedback": "one sentence", "breakdown": {"had_decisions": true/false, "had_action_owners": true/false, "had_clear_outcomes": true/false}},
  "contradictions": ["description of any contradiction with prior context if found, else empty array"]
}

Prior context from earlier meetings in this project:
${priorContext||"None"}

Current meeting summary:
${summary}`,600);
      return parseJsonSafe(raw)||{decisions:[],commitments:[],risks:[],quality:null,contradictions:[]};
    }catch{return{decisions:[],commitments:[],risks:[],quality:null,contradictions:[]};}
  };

  // FIX #8: generateHomeSummary now fetches fresh data instead of reading the
  // stale `data` closure, so notes added just before clicking Refresh are included.
  const generateHomeSummary=async()=>{
    if(!userId)return;setHomeLoading(true);
    try{
      const d=await db.loadAll(userId);
      const projectContext=d.projects.map(p=>{
        const openTasks=(d.todos||[]).filter(t=>!t.done&&t.projectId===p.id);
        const doneTasks=(d.todos||[]).filter(t=>t.done&&t.projectId===p.id);
        const openCommitments=(p.commitments||[]).filter(c=>c.status==="open");
        const pRisks=(p.risks||[]).filter(r=>!r.dismissed);
        return `### ${p.name}
Status: ${p.status||"No status yet"}
Open tasks (${openTasks.length}): ${openTasks.length>0?openTasks.map(t=>`- ${t.text}${t.dueDate?` (due ${fmtShort(t.dueDate)})`:""}${isOverdue(t.dueDate)?" OVERDUE":""}`).join("\n"):"none"}
Completed: ${doneTasks.length>0?doneTasks.map(t=>`- ${t.text}`).join(", "):"none"}
Open commitments: ${openCommitments.length>0?openCommitments.map(c=>`- ${c.commitment_text}`).join("\n"):"none"}
Risks: ${pRisks.length>0?pRisks.map(r=>`[${r.severity}] ${r.risk_text}`).join("\n"):"none"}
Recent notes: ${p.notes.slice(-2).map(n=>`[${fmt(n.date)}] ${n.summary.slice(0,200)}`).join(" | ")||"none"}`;
      }).join("\n\n");
      const standaloneTasks=(d.todos||[]).filter(t=>!t.projectId);
      const standaloneContext=standaloneTasks.length>0?standaloneTasks.map(t=>`- [${t.done?"DONE":"PENDING"}] ${t.text}${t.dueDate?` (due ${fmtShort(t.dueDate)})`:""}${!t.done&&isOverdue(t.dueDate)?" OVERDUE":""}`).join("\n"):"none";
      const prompt=`You are writing a weekly executive briefing for ${d.me||"the user"}. Be specific and direct. Use their actual project and task names. No filler.

ALL PROJECTS:
${projectContext||"No projects yet."}

STANDALONE TASKS (no project):
${standaloneContext}

Write in exactly this format:

## Projects
For each project with notes or tasks, write:
### [Project Name]
One sentence on current status. Then bullet list of open tasks (mark OVERDUE). Include any open commitments and risks. Skip projects with nothing.

## Standalone Tasks
Bullet list of tasks not tied to any project. If none write "None."

## Next Week
3-5 specific prioritised actions using actual task and project names.`;
      const summary=await claude(prompt,1000);
      await db.upsertHomeSummary(userId,summary);await reload();
    }catch(e){console.error(e);}finally{setHomeLoading(false);}
  };

  const addTodo=async()=>{
    if(!newTodoText.trim()||!userId)return;
    const assignedProjectId=newTodoProjectId||(activeIdx!==null?activeProject?.id:null);
    const t=await db.createTodo(userId,{text:newTodoText.trim(),dueDate:newTodoDue||null,projectId:assignedProjectId||null,source:'manual',memberId:newTodoMemberId||null});
    setData(d=>({...d,todos:[...d.todos,t]}));
    setNewTodoText("");setNewTodoDue("");setNewTodoProjectId("");setNewTodoMemberId("");
  };

  const extractTodosFromNote=async(summary,projectId)=>{
    if(!data?.me||!userId)return[];
    try{
      const raw=await claude(`Extract action items for "${data.me}" from this summary. Return ONLY a JSON array of strings. If none, return [].\n${summary}`,300);
      const items=parseJsonSafe(raw);
      if(!Array.isArray(items)||items.length===0)return[];
      const existing=new Set(todos.map(t=>t.text.toLowerCase()));
      const fresh=items.filter(t=>!existing.has(t.toLowerCase()));
      return await Promise.all(fresh.map(text=>db.createTodo(userId,{text,projectId,source:'ai'})));
    }catch{return[];}
  };

  const toggleTodo=async id=>{
    const todo=todos.find(t=>t.id===id);if(!todo)return;
    const nowDone=!todo.done;
    await db.toggleTodo(id,nowDone);
    setData(d=>({...d,todos:d.todos.map(t=>t.id===id?{...t,done:nowDone}:t)}));
    if(nowDone&&todo.projectId){
      const pIdx=projects.findIndex(p=>p.id===todo.projectId);
      if(pIdx>=0&&projects[pIdx].notes.length>0){
        try{const s=await claude(`Latest status for "${projects[pIdx].name}". Note: "${todo.text}" just completed.\n${projects[pIdx].notes.map((n,i)=>`Meeting ${i+1}:\n${n.summary}`).join("\n\n")}`,700);await db.updateProjectStatus(todo.projectId,s);await reload();}catch{}
      }
    }
  };

  const deleteTodo=async id=>{await db.deleteTodo(id);setData(d=>({...d,todos:d.todos.filter(t=>t.id!==id)}));};
  const addMember=async()=>{if(!newMemberName.trim()||!userId)return;const m=await db.createMember(userId,{name:newMemberName.trim(),role:newMemberRole.trim()});setData(d=>({...d,members:[...d.members,m]}));setNewMemberName("");setNewMemberRole("");};
  const deleteMember=async id=>{await db.deleteMember(id);setData(d=>({...d,members:d.members.filter(m=>m.id!==id)}));};

  const generateMemberSummary=async memberId=>{
    setMemberLoading(true);
    try{
      const member=members.find(m=>m.id===memberId);if(!member)return;
      const mentions=[];
      for(const p of projects) for(const n of p.notes) if(n.raw.toLowerCase().includes(member.name.toLowerCase())||n.taggedMembers?.includes(member.id)) mentions.push({project:p.name,date:n.date,summary:n.summary});
      const allCommitments=projects.flatMap(p=>(p.commitments||[]).filter(c=>c.member_id===memberId));
      const summary=mentions.length===0?"No notes mention this person yet.":await claude(`Summarise ${member.name}'s activity across all projects.\n\nMeeting appearances:\n${mentions.map(m=>`[${m.project}] ${fmt(m.date)}:\n${m.summary}`).join("\n\n---\n\n")}\n\nCommitments (${allCommitments.length}):\n${allCommitments.map(c=>`- [${c.status}] ${c.commitment_text}`).join("\n")||"none"}`,900);
      const intelligence=mentions.length>0?await claude(`Based on these meeting notes, build a stakeholder intelligence profile for ${member.name}. Cover: what they care about most, how they communicate, what they tend to push back on, their reliability on commitments, and how to work with them effectively. Be specific and concise.\n\n${mentions.map(m=>`[${m.project}] ${fmt(m.date)}:\n${m.summary}`).join("\n\n")}`,500):"";
      await db.updateMemberSummary(memberId,summary);
      if(intelligence) await db.updateMemberIntelligence(memberId,intelligence);
      await reload();
    }catch{}finally{setMemberLoading(false);}
  };

  const createProject=async()=>{
    if(!newProjName.trim()||!userId)return;
    const p=await db.createProject(userId,newProjName.trim());
    setData(d=>({...d,projects:[...d.projects,p]}));
    setActiveIdx(data.projects.length);setNewProjName("");setView("project");
  };

  const buildPriorCtx=proj=>{
    if(!proj||proj.notes.length===0)return"";
    const parts=[];
    if(proj.status)parts.push(`Status:\n${proj.status}`);
    proj.notes.slice(-3).forEach(n=>parts.push(`[${fmt(n.date)}]\n${n.summary}`));
    return parts.join("\n\n");
  };

  const analyseNote=async notesVal=>{
    if(!notesVal.trim()){setError("Please enter notes.");return;}
    setNotes(notesVal);setError("");setLoading(true);
    const mentioned=extractMentions(notesVal),selfTagged=meInNotes(notesVal);
    // FIX #6: Store in refs so finaliseNote always reads correct values
    taggedMembersRef.current=mentioned;
    taggedSelfRef.current=selfTagged;
    setTaggedMembers(mentioned);setTaggedSelf(selfTagged);
    try{
      const prior=buildPriorCtx(activeProject);
      const raw=await claude(`Review new meeting notes.${prior?` Existing context:\n${prior}\n\n`:" "}Identify up to 3 things STILL unclear. Return [] if clear. ONLY a valid JSON array of strings.\n\nNotes:\n${notesVal}`,400);
      const qs=parseJsonSafe(raw);
      if(!qs||!Array.isArray(qs)||qs.length===0){await finaliseNote(notesVal,{},mentioned,selfTagged);}
      else{setQuestions(qs);setAnswers(Object.fromEntries(qs.map((_,i)=>[i,""])));setNotePhase("clarifying");}
    }catch{await finaliseNote(notesVal,{},mentioned,selfTagged);}
    finally{setLoading(false);}
  };

  const finaliseNote=async(notesVal,ans,mentionedOvr,selfOvr)=>{
    setLoading(true);setError("");
    // FIX #6: Fall back to refs if overrides not provided (clarifying-phase path)
    const n=notesVal||notes;
    const mentioned=mentionedOvr??taggedMembersRef.current;
    const selfMentioned=selfOvr??taggedSelfRef.current;
    try{
      const clarifs=questions.length>0?"\n\nClarifications:\n"+questions.map((q,i)=>ans[i]?`Q: ${q}\nA: ${ans[i]}`:null).filter(Boolean).join("\n"):"";
      const summary=await claude(`Convert to structured summary:\n1. Overview\n2. Key decisions\n3. Action items\n4. Discussion\n5. Next steps\nUse markdown.\n\nNotes:\n${n}${clarifs}`,1200);

      const note=await db.createNote(userId,activeProject.id,{raw:n,summary,selfTagged:selfMentioned,taggedMemberIds:mentioned.map(m=>m.id)});

      const intel=await extractIntelligence(summary,note.id,activeProject.id,activeProject.name,activeProject.notes);

      await Promise.all([
        intel.decisions?.length>0?db.saveDecisions(userId,activeProject.id,note.id,intel.decisions):Promise.resolve(),
        intel.commitments?.length>0?db.saveCommitments(userId,activeProject.id,note.id,intel.commitments,members):Promise.resolve(),
        intel.risks?.length>0?db.saveRisks(userId,activeProject.id,intel.risks):Promise.resolve(),
        intel.quality?db.saveQualityScore(userId,note.id,intel.quality):Promise.resolve(),
      ]);

      const d=await reload();
      const proj=d.projects.find(p=>p.id===activeProject.id);
      if(proj){
        const allS=proj.notes.map((nn,i)=>`Meeting ${i+1} (${fmt(nn.date)}):\n${nn.summary}`).join("\n\n");
        const status=await claude(`Latest status for "${proj.name}". Current state, open actions, decisions, blockers, next steps.\n${allS}`,700);
        await db.updateProjectStatus(proj.id,status);
      }

      if(selfMentioned)await extractTodosFromNote(summary,activeProject.id);

      for(const m of mentioned){
        const allM=[];
        for(const p of(d.projects||[])) for(const nn of p.notes) if(nn.raw.toLowerCase().includes(m.name.toLowerCase())||nn.taggedMembers?.includes(m.id)) allM.push({project:p.name,date:nn.date,summary:nn.summary});
        if(allM.length>0){try{const ms=await claude(`Summarise ${m.name}'s activity.\n\n${allM.map(a=>`[${a.project}] ${fmt(a.date)}:\n${a.summary}`).join("\n\n---\n\n")}`,700);await db.updateMemberSummary(m.id,ms);}catch{}}
      }

      await reload();
      setNotes("");setQuestions([]);setAnswers({});setTaggedMembers([]);setTaggedSelf(false);
      taggedMembersRef.current=[];taggedSelfRef.current=false;
      setNotePhase("input");
      setView("project");
    }catch(e){setError("Failed to save. Please try again.");console.error(e);}
    finally{setLoading(false);}
  };

  const deleteNote=async noteId=>{
    await db.deleteNote(noteId);
    const d=await reload();
    const proj=d.projects.find(p=>p.id===activeProject?.id);
    if(proj&&proj.notes.length>0){try{const status=await claude(`Latest status for "${proj.name}":\n${proj.notes.map((n,i)=>`Meeting ${i+1}:\n${n.summary}`).join("\n\n")}`,700);await db.updateProjectStatus(proj.id,status);await reload();}catch{}}
  };

  const saveEditedNote=async(noteId,newRaw)=>{
    if(!newRaw.trim())return;setEditSaving(true);
    try{
      const summary=await claude(`Convert to structured summary:\n1. Overview\n2. Key decisions\n3. Action items\n4. Discussion\n5. Next steps\nUse markdown.\n\nNotes:\n${newRaw}`,1200);
      await db.updateNote(noteId,{raw:newRaw,summary});
      const d=await reload();
      const proj=d.projects.find(p=>p.id===activeProject?.id);
      if(proj){const allS=proj.notes.map((n,i)=>`Meeting ${i+1} (${fmt(n.date)}):\n${n.summary}`).join("\n\n");const status=await claude(`Latest status for "${proj.name}".\n${allS}`,700);await db.updateProjectStatus(proj.id,status);await reload();}
      setEditingNote(null);
    }catch(e){console.error(e);}finally{setEditSaving(false);}
  };

  // FIX #10: shareNote now uses Toast instead of alert()
  const shareNote=async(note,projectName)=>{
    const text=`${projectName} — ${fmt(note.date)}\n\n${note.summary.replace(/[#*]/g,"").trim()}`;
    if(navigator.share){try{await navigator.share({title:`Debrief — ${projectName}`,text});return;}catch{}}
    try{
      await navigator.clipboard.writeText(text);
      setToast("Summary copied to clipboard");
    }catch{setToast("Copy failed — please copy manually");}
  };

  // FIX #9: deleteProject now requires confirmation before proceeding.
  const deleteProject=async idx=>{
    const name=projects[idx]?.name||"this project";
    if(!window.confirm(`Delete "${name}"? This will permanently remove all notes, decisions, commitments and risks. This cannot be undone.`))return;
    await db.deleteProject(projects[idx].id);
    await reload();setView("home");setActiveIdx(null);
  };

  const pendingTodos=todos.filter(t=>!t.done);
  const doneTodos=todos.filter(t=>t.done);
  const overdueTodos=pendingTodos.filter(t=>isOverdue(t.dueDate));
  const thisWeekTodos=pendingTodos.filter(t=>isThisWeek(t.dueDate)||(!t.dueDate&&isThisWeek(t.createdAt)));
  const upcomingTodos=pendingTodos.filter(t=>!isThisWeek(t.dueDate)&&!isOverdue(t.dueDate)&&t.dueDate);
  const undatedTodos=pendingTodos.filter(t=>!t.dueDate&&!isThisWeek(t.createdAt));

  const Nav=()=>(
    <div style={{marginBottom:24,paddingBottom:14,borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
      <div style={{display:"flex",alignItems:"center",gap:16}}>
        <Logo/>
        <div id="tour-nav" style={{display:"flex",gap:0,flexWrap:"wrap"}}>
          {[["home","Overview"],["todos","My Tasks"],["team","Team"]].map(([v,label])=>(
            <button key={v} onClick={()=>setView(v)} style={{padding:"5px 12px",fontSize:"13px",fontWeight:view===v?700:400,color:view===v?T.accent:T.mid,background:"transparent",border:"none",borderBottom:view===v?`2px solid ${T.accent}`:"2px solid transparent",cursor:"pointer",fontFamily:T.sans}}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {data?.me&&<div style={{display:"flex",alignItems:"center",gap:5}}><Av name={data.me} size={22} isSelf/><span style={{fontSize:"12px",color:T.mid}}>{data.me}</span></div>}
        {undismissedRisks.length>0&&(
          <div onClick={()=>setView("home")} style={{position:"relative",cursor:"pointer"}} title={`${undismissedRisks.length} active risk${undismissedRisks.length>1?"s":""}`}>
            <span style={{fontSize:"13px",color:T.danger}}>⚠</span>
            <span style={{position:"absolute",top:-4,right:-4,background:T.danger,color:"#fff",borderRadius:"50%",width:14,height:14,fontSize:"9px",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{undismissedRisks.length}</span>
          </div>
        )}
        <div id="tour-project" style={{display:"inline-block"}}>
          <Btn size="sm" onClick={()=>{setNewProjName("");setView("newProject");}}>+ Project</Btn>
        </div>
        <Btn size="sm" variant="secondary" onClick={signOut}>Sign out</Btn>
      </div>
    </div>
  );

  const SectionTitle=({children,sub})=>(
    <div style={{marginBottom:14}}>
      <h2 style={{margin:0,fontSize:"18px",fontWeight:700,fontFamily:T.serif,color:T.ink,letterSpacing:"-0.01em"}}>{children}</h2>
      {sub&&<p style={{margin:"2px 0 0",fontSize:"12px",color:T.muted}}>{sub}</p>}
    </div>
  );

  const SearchEl=()=>showSearch?<SearchAskOverlay projects={projects} members={members} todos={todos} onClose={()=>setShowSearch(false)} onProjectNav={i=>{setActiveIdx(i);setView("project");}}/>:null;

  if(!data) return <Shell><div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"60vh"}}><p style={{color:T.muted}}>Loading your workspace…</p></div></Shell>;

  if(!data.me) return (
    <Shell maxW={400}>
      <div style={{paddingTop:60,textAlign:"center"}}>
        <div style={{marginBottom:24,display:"flex",justifyContent:"center"}}><Logo/></div>
        <h1 style={{fontFamily:T.serif,fontSize:"26px",fontWeight:700,margin:"0 0 8px",color:T.ink}}>Welcome to Debrief</h1>
        <p style={{color:T.mid,fontSize:"13px",margin:"0 0 32px",lineHeight:1.6}}>What should we call you?</p>
        <Card>
          <Label>Your Name</Label>
          <input value={meName} onChange={e=>setMeName(e.target.value)} placeholder="e.g. John" onKeyDown={e=>e.key==="Enter"&&saveMe()} style={inp}/>
          <div style={{marginTop:12}}><Btn onClick={saveMe} disabled={!meName.trim()}>Get started →</Btn></div>
        </Card>
      </div>
    </Shell>
  );

  // ── HOME ────────────────────────────────────────────────────────────────────
  if(view==="home") return (
    <Shell>
      {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
      <SearchEl/>
      {showTour&&<Tour onDone={handleTourDone}/>}
      <BottomSearchBar onClick={()=>setShowSearch(true)}/>
      <Nav/>

      {undismissedRisks.length>0&&(
        <Card style={{marginBottom:14,borderLeft:`3px solid ${T.danger}`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:"16px"}}>⚠</span>
              <h2 style={{margin:0,fontFamily:T.serif,fontSize:"15px",fontWeight:700,color:T.danger}}>Risk Radar</h2>
              <span style={{background:T.danger+"14",color:T.danger,borderRadius:2,padding:"1px 7px",fontSize:"11px",fontWeight:700}}>{undismissedRisks.length} active</span>
            </div>
          </div>
          {undismissedRisks.slice(0,4).map(r=>{
            const proj=projects.find(p=>p.id===r.project_id);
            return(
              <div key={r.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"7px 0",borderBottom:`1px solid ${T.border}`}}>
                <SeverityBadge severity={r.severity}/>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{margin:0,fontSize:"13px",color:T.ink,lineHeight:1.4}}>{r.risk_text}</p>
                  {proj&&<span style={{fontSize:"11px",color:T.muted}}>{proj.name}</span>}
                </div>
                <button onClick={()=>db.dismissRisk(r.id).then(reload)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:12,padding:0,flexShrink:0,whiteSpace:"nowrap"}}>Dismiss</button>
              </div>
            );
          })}
        </Card>
      )}

      <Card accent={T.accent} style={{marginBottom:14}}>
        <div id="tour-briefing" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,gap:8,flexWrap:"wrap"}}>
          <div>
            <h2 style={{margin:0,fontFamily:T.serif,fontSize:"16px",fontWeight:700,color:T.ink}}>Weekly Briefing</h2>
            {data.homeWeeklySummaryDate&&<p style={{margin:"2px 0 0",fontSize:"11px",color:T.mid}}>Updated {fmt(data.homeWeeklySummaryDate)}</p>}
          </div>
          <Btn variant="secondary" size="sm" onClick={generateHomeSummary} disabled={homeLoading}>{homeLoading?"Updating…":data.homeWeeklySummary?"↻ Refresh":"Generate"}</Btn>
        </div>
        {homeLoading?<p style={{color:T.mid,fontSize:"13px"}}>Generating your briefing…</p>
          :data.homeWeeklySummary?<MD content={data.homeWeeklySummary} small/>
          :<p style={{color:T.mid,fontSize:"13px",margin:0}}>Click Generate to see a full summary of all your projects and tasks.</p>}
      </Card>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Card>
          <h3 id="tour-tasks" style={{margin:"0 0 10px",fontSize:"13px",fontWeight:600,color:T.ink}}>This Week <span style={{fontSize:"11px",fontWeight:400,color:T.muted}}>({thisWeekTodos.length+overdueTodos.length})</span></h3>
          {[...overdueTodos.slice(0,2),...thisWeekTodos.slice(0,3)].map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}}/>)}
          {thisWeekTodos.length===0&&overdueTodos.length===0&&<p style={{fontSize:"12px",color:T.muted,margin:0}}>No tasks due this week.</p>}
        </Card>
        <Card>
          <h3 style={{margin:"0 0 10px",fontSize:"13px",fontWeight:600,color:T.ink}}>Projects <span style={{fontSize:"11px",fontWeight:400,color:T.muted}}>({projects.length})</span></h3>
          {projects.length===0?<p style={{fontSize:"12px",color:T.muted,margin:0}}>No projects yet.</p>
            :projects.slice(0,6).map((p,i)=>{
              const pRisks=(p.risks||[]).filter(r=>!r.dismissed).length;
              return(
                <div key={p.id} onClick={()=>{setActiveIdx(i);setView("project");}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${T.border}`,cursor:"pointer"}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,minWidth:0}}>
                    <div style={{width:3,height:14,background:pc(i),flexShrink:0}}/>
                    <span style={{fontSize:"13px",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:T.ink}}>{p.name}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                    {pRisks>0&&<span style={{fontSize:"10px",color:T.danger}}>⚠ {pRisks}</span>}
                    <span style={{fontSize:"11px",color:T.muted}}>{p.notes.length}</span>
                  </div>
                </div>
              );
            })}
        </Card>
      </div>
    </Shell>
  );

  // ── TODOS ───────────────────────────────────────────────────────────────────
  if(view==="todos") return (
    <Shell>
      {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
      <SearchEl/>
      <BottomSearchBar onClick={()=>setShowSearch(true)}/>
      <Nav/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <SectionTitle>My Tasks</SectionTitle>
        <div style={{display:"flex",gap:6}}>
          {["pending","done"].map(f=>(
            <button key={f} onClick={()=>setTodoFilter(f)} style={{padding:"4px 12px",fontSize:"12px",fontWeight:todoFilter===f?600:400,color:todoFilter===f?T.accent:T.mid,background:todoFilter===f?T.accentLight:"transparent",border:`1px solid ${todoFilter===f?T.accent:T.border}`,borderRadius:2,cursor:"pointer",fontFamily:T.sans}}>
              {f==="pending"?`Pending (${pendingTodos.length})`:`Done (${doneTodos.length})`}
            </button>
          ))}
        </div>
      </div>
      <Card>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div style={{flex:"1 1 140px"}}><Label>Task</Label><input value={newTodoText} onChange={e=>setNewTodoText(e.target.value)} placeholder="Add a task…" onKeyDown={e=>e.key==="Enter"&&addTodo()} style={inp}/></div>
          <div style={{flex:"1 1 110px"}}><Label>Project</Label><select value={newTodoProjectId} onChange={e=>setNewTodoProjectId(e.target.value)} style={{...inp}}><option value="">No project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div style={{flex:"1 1 110px"}}><Label>Assign to</Label><select value={newTodoMemberId} onChange={e=>setNewTodoMemberId(e.target.value)} style={{...inp}}><option value="">Myself</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div style={{flex:"0 0 auto"}}><Label>Due</Label><input type="date" value={newTodoDue} onChange={e=>setNewTodoDue(e.target.value)} style={{...inp,width:"auto"}}/></div>
          <Btn onClick={addTodo} disabled={!newTodoText.trim()}>Add</Btn>
        </div>
      </Card>
      {todoFilter==="pending"&&(<>
        {overdueTodos.length>0&&<><GroupLabel color={T.danger}>Overdue</GroupLabel><Card>{overdueTodos.map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}}/>)}</Card></>}
        {thisWeekTodos.length>0&&<><GroupLabel>This Week</GroupLabel><Card>{thisWeekTodos.map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}}/>)}</Card></>}
        {upcomingTodos.length>0&&<><GroupLabel>Upcoming</GroupLabel><Card>{upcomingTodos.map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}}/>)}</Card></>}
        {undatedTodos.length>0&&<><GroupLabel>No Date</GroupLabel><Card>{undatedTodos.map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}}/>)}</Card></>}
        {pendingTodos.length===0&&<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>All caught up.</p></Card>}
      </>)}
      {todoFilter==="done"&&(doneTodos.length===0?<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No completed tasks yet.</p></Card>:<Card>{[...doneTodos].reverse().map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo}/>)}</Card>)}
    </Shell>
  );

  // ── TEAM ────────────────────────────────────────────────────────────────────
  if(view==="team") return (
    <Shell>
      {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
      <SearchEl/>
      <BottomSearchBar onClick={()=>setShowSearch(true)}/>
      <Nav/>
      <SectionTitle sub="Tag members in notes using @name.">Team</SectionTitle>
      <Card>
        <Label>Add Member</Label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <input value={newMemberName} onChange={e=>setNewMemberName(e.target.value)} placeholder="Full name" style={{...inp,flex:"1 1 120px"}} onKeyDown={e=>e.key==="Enter"&&addMember()}/>
          <input value={newMemberRole} onChange={e=>setNewMemberRole(e.target.value)} placeholder="Role (optional)" style={{...inp,flex:"1 1 120px"}} onKeyDown={e=>e.key==="Enter"&&addMember()}/>
          <Btn onClick={addMember} disabled={!newMemberName.trim()}>Add</Btn>
        </div>
      </Card>
      {members.length===0?<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No team members yet.</p></Card>
        :<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:8}}>
          {members.map(m=>{
            const nc=projects.reduce((a,p)=>a+p.notes.filter(n=>n.taggedMembers?.includes(m.id)||n.raw.toLowerCase().includes(m.name.toLowerCase())).length,0);
            const openComm=projects.flatMap(p=>(p.commitments||[]).filter(c=>c.member_id===m.id&&c.status==="open")).length;
            return(
              <Card key={m.id} accent={avatarBg(m.name)} style={{cursor:"pointer",marginBottom:0}}>
                <div onClick={()=>{setActiveMemberId(m.id);setView("memberView");}} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <Av name={m.name} size={30}/>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:"13px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:T.ink}}>{m.name}</div>
                    {m.role&&<div style={{fontSize:"11px",color:T.muted}}>{m.role}</div>}
                  </div>
                </div>
                <div style={{display:"flex",gap:8,fontSize:"11px",color:T.muted}}>
                  <span>{nc} notes</span>
                  {openComm>0&&<span style={{color:T.warning}}>⚡ {openComm} open</span>}
                </div>
              </Card>
            );
          })}
        </div>}
    </Shell>
  );

  // ── MEMBER VIEW ─────────────────────────────────────────────────────────────
  if(view==="memberView"&&activeMember) return (
    <Shell>
      {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
      <SearchEl/>
      <BottomSearchBar onClick={()=>setShowSearch(true)}/>
      <Nav/>
      <button onClick={()=>setView("team")} style={{fontSize:"12px",color:T.mid,background:"none",border:"none",cursor:"pointer",padding:"0 0 16px",fontFamily:T.sans}}>← Team</button>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,flexWrap:"wrap"}}>
        <Av name={activeMember.name} size={44}/>
        <div style={{flex:1,minWidth:0}}>
          <h1 style={{margin:0,fontFamily:T.serif,fontSize:"20px",fontWeight:700,color:T.ink}}>{activeMember.name}</h1>
          {activeMember.role&&<p style={{margin:"2px 0 0",fontSize:"13px",color:T.mid}}>{activeMember.role}</p>}
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <Btn variant="secondary" size="sm" onClick={()=>generateMemberSummary(activeMember.id)} disabled={memberLoading}>{memberLoading?"Updating…":activeMember.summary?"↻ Refresh":"Generate"}</Btn>
          <Btn variant="danger" size="sm" onClick={()=>{deleteMember(activeMember.id);setView("team");}}>Remove</Btn>
        </div>
      </div>

      {activeMember.intelligence&&(
        <Card style={{marginBottom:10,background:T.accentLight,border:`1px solid ${T.accentMid}30`}}>
          <h3 style={{margin:"0 0 8px",fontSize:"13px",fontWeight:700,color:T.accent,letterSpacing:"0.04em",textTransform:"uppercase"}}>Stakeholder Intelligence</h3>
          <p style={{margin:0,fontSize:"13px",color:T.ink,lineHeight:1.6,textAlign:"left"}}>{activeMember.intelligence}</p>
        </Card>
      )}

      <Card accent={avatarBg(activeMember.name)}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
          <h2 style={{margin:0,fontFamily:T.serif,fontSize:"15px",fontWeight:700,color:T.ink}}>Activity Summary</h2>
          {activeMember.summary_updated_at&&<span style={{fontSize:"11px",color:T.muted}}>{fmt(activeMember.summary_updated_at)}</span>}
        </div>
        {memberLoading?<p style={{color:T.muted,fontSize:"13px"}}>Generating…</p>
          :activeMember.summary?<MD content={activeMember.summary} small/>
          :<p style={{color:T.muted,fontSize:"13px",margin:0}}>Tag @{activeMember.name} in notes or click Generate.</p>}
      </Card>

      {(()=>{
        const memberCommitments=projects.flatMap(p=>(p.commitments||[]).filter(c=>c.member_id===activeMember.id).map(c=>({...c,projectName:p.name})));
        if(!memberCommitments.length)return null;
        return(
          <Card>
            <h3 style={{margin:"0 0 10px",fontSize:"13px",fontWeight:600,color:T.ink}}>Commitments ({memberCommitments.length})</h3>
            {memberCommitments.map(c=>(
              <div key={c.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"7px 0",borderBottom:`1px solid ${T.border}`}}>
                <span style={{fontSize:"12px",flexShrink:0,marginTop:1,color:c.status==="open"?T.warning:T.success}}>{c.status==="open"?"●":"✓"}</span>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{margin:0,fontSize:"13px",color:T.ink,lineHeight:1.4}}>{c.commitment_text}</p>
                  <span style={{fontSize:"11px",color:T.muted}}>{c.projectName} · {fmt(c.date)}</span>
                </div>
                {c.status==="open"&&<button onClick={()=>db.updateCommitmentStatus(c.id,"done").then(reload)} style={{background:"none",border:"none",fontSize:"11px",color:T.success,cursor:"pointer",padding:0,flexShrink:0}}>Mark done</button>}
              </div>
            ))}
          </Card>
        );
      })()}

      {(()=>{
        const mentions=[];
        for(const p of projects) for(const n of p.notes) if(n.taggedMembers?.includes(activeMember.id)||n.raw.toLowerCase().includes(activeMember.name.toLowerCase())) mentions.push({...n,projectName:p.name,projIdx:projects.findIndex(pp=>pp.name===p.name)});
        if(!mentions.length) return <Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No notes mention this person yet.</p></Card>;
        return(<><GroupLabel>Meeting Notes ({mentions.length})</GroupLabel>{[...mentions].reverse().map(n=>(
          <Card key={n.id}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5,flexWrap:"wrap",gap:6}}>
              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}><Tag color={pc(n.projIdx)}>{n.projectName}</Tag><span style={{fontSize:"11px",color:T.muted}}>{fmt(n.date)}</span></div>
              <Btn variant="ghost" size="sm" onClick={()=>setExpandedNote(expandedNote===n.id?null:n.id)}>{expandedNote===n.id?"Hide":"View"}</Btn>
            </div>
            {expandedNote===n.id?<MD content={n.summary} small/>:<p style={{fontSize:"12px",color:T.muted,margin:0,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{n.summary.replace(/[#*]/g,"").slice(0,100)}…</p>}
          </Card>
        ))}</>);
      })()}
    </Shell>
  );

  // ── NEW PROJECT ─────────────────────────────────────────────────────────────
  if(view==="newProject") return (
    <Shell maxW={440}>
      <Nav/>
      <SectionTitle>New Project</SectionTitle>
      <Card>
        <Label>Project Name</Label>
        <input style={inp} value={newProjName} onChange={e=>setNewProjName(e.target.value)} placeholder="e.g. Product Launch Q2" onKeyDown={e=>e.key==="Enter"&&createProject()}/>
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <Btn onClick={createProject} disabled={!newProjName.trim()}>Create Project</Btn>
          <Btn variant="secondary" onClick={()=>setView("home")}>Cancel</Btn>
        </div>
      </Card>
    </Shell>
  );

  // ── PROJECT VIEW ────────────────────────────────────────────────────────────
  if(view==="project"&&activeProject) return (
    <Shell>
      {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
      <SearchEl/>
      {editingNote&&<EditNoteModal note={editingNote} projectName={activeProject.name} onSave={raw=>saveEditedNote(editingNote.id,raw)} onCancel={()=>setEditingNote(null)} saving={editSaving}/>}
      <BottomSearchBar onClick={()=>setShowSearch(true)}/>
      <Nav/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          <button onClick={()=>setView("home")} style={{fontSize:"12px",color:T.mid,background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:T.sans,flexShrink:0}}>← Overview</button>
          <div style={{width:3,height:16,background:pc(activeIdx),flexShrink:0}}/>
          <h1 style={{margin:0,fontFamily:T.serif,fontSize:"19px",fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:T.ink}}>{activeProject.name}</h1>
        </div>
        <div style={{display:"flex",gap:6}}>
          <Btn size="sm" onClick={()=>{setNotePhase("input");setNotes("");setError("");setTaggedMembers([]);setTaggedSelf(false);setView("addNote");}}>+ Add Notes</Btn>
          <Btn variant="danger" size="sm" onClick={()=>deleteProject(activeIdx)}>Delete</Btn>
        </div>
      </div>

      {todos.filter(t=>t.projectId===activeProject.id&&!t.done).length>0&&(
        <Card>
          <h3 style={{margin:"0 0 8px",fontSize:"13px",fontWeight:600,color:T.ink}}>My Open Tasks</h3>
          {todos.filter(t=>t.projectId===activeProject.id&&!t.done).map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo}/>)}
        </Card>
      )}

      <Card accent={pc(activeIdx)}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
          <h2 style={{margin:0,fontFamily:T.serif,fontSize:"15px",fontWeight:700,color:T.ink}}>Project Status</h2>
          {activeProject.status_updated_at&&<span style={{fontSize:"11px",color:T.muted}}>Updated {fmt(activeProject.status_updated_at)}</span>}
        </div>
        {activeProject.notes.length===0?<p style={{color:T.muted,fontSize:"13px",margin:0}}>Status generates after first note.</p>
          :activeProject.status?<MD content={activeProject.status} small/>
          :<p style={{color:T.muted,fontSize:"13px",margin:0}}>Status will appear after first note.</p>}
      </Card>

      <div style={{display:"flex",gap:0,borderBottom:`1px solid ${T.border}`,marginBottom:12,marginTop:4}}>
        {[
          ["notes",`Notes (${activeProject.notes.length})`],
          ["decisions",`Decisions (${(activeProject.decisions||[]).length})`],
          ["commitments",`Commitments (${(activeProject.commitments||[]).filter(c=>c.status==="open").length} open)`],
          ["risks",`Risks (${(activeProject.risks||[]).filter(r=>!r.dismissed).length})`],
        ].map(([tab,label])=>(
          <button key={tab} onClick={()=>setActiveProjectTab(tab)} style={{padding:"7px 14px",fontSize:"12px",fontWeight:activeProjectTab===tab?700:400,color:activeProjectTab===tab?T.accent:T.mid,background:"transparent",border:"none",borderBottom:activeProjectTab===tab?`2px solid ${T.accent}`:"2px solid transparent",cursor:"pointer",fontFamily:T.sans,whiteSpace:"nowrap"}}>
            {label}
          </button>
        ))}
      </div>

      {activeProjectTab==="notes"&&(
        activeProject.notes.length===0?<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No notes yet.</p></Card>
        :[...activeProject.notes].reverse().map(n=>{
          const tagged=(n.taggedMembers||[]).map(id=>members.find(m=>m.id===id)).filter(Boolean);
          return(
            <Card key={n.id}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6,gap:6}}>
                <div style={{minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span style={{fontSize:"12px",color:T.muted}}>{fmt(n.date)}</span>
                    {n.qualityScore&&<ScoreBadge score={n.qualityScore.score}/>}
                    {n.qualityScore&&<span style={{fontSize:"11px",color:T.muted}}>{n.qualityScore.feedback}</span>}
                  </div>
                  {(tagged.length>0||n.selfTagged)&&(
                    <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>
                      {n.selfTagged&&<Tag color={T.accent}>You</Tag>}
                      {tagged.map(m=><Tag key={m.id} color={avatarBg(m.name)} onClick={()=>{setActiveMemberId(m.id);setView("memberView");}}>{m.name}</Tag>)}
                    </div>
                  )}
                </div>
                <div style={{display:"flex",gap:5,flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
                  <Btn variant="secondary" size="sm" onClick={()=>setExpandedNote(expandedNote===n.id?null:n.id)}>{expandedNote===n.id?"Hide":"View"}</Btn>
                  <Btn variant="secondary" size="sm" onClick={()=>setEditingNote(n)}>Edit</Btn>
                  <Btn variant="secondary" size="sm" onClick={()=>shareNote(n,activeProject.name)}>Share</Btn>
                  <Btn variant="danger" size="sm" onClick={()=>deleteNote(n.id)}>Del</Btn>
                </div>
              </div>
              {expandedNote===n.id?<div style={{borderTop:`1px solid ${T.border}`,paddingTop:10}}><MD content={n.summary} small/></div>
                :<p style={{fontSize:"12px",color:T.muted,margin:0,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{n.summary.replace(/[#*]/g,"").slice(0,110)}…</p>}
            </Card>
          );
        })
      )}

      {activeProjectTab==="decisions"&&(
        (activeProject.decisions||[]).length===0
          ?<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No decisions extracted yet. Decisions are auto-detected when you add meeting notes.</p></Card>
          :[...activeProject.decisions].reverse().map(d=>(
            <Card key={d.id} accent={T.accent}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4,gap:6}}>
                <p style={{margin:0,fontSize:"13px",fontWeight:600,color:T.ink,flex:1}}>{d.decision_text}</p>
                <span style={{fontSize:"11px",color:T.muted,flexShrink:0}}>{fmt(d.date)}</span>
              </div>
              {d.context&&<p style={{margin:0,fontSize:"12px",color:T.mid,lineHeight:1.5}}>{d.context}</p>}
            </Card>
          ))
      )}

      {activeProjectTab==="commitments"&&(
        (activeProject.commitments||[]).length===0
          ?<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No commitments extracted yet. Commitments are auto-detected when you add meeting notes.</p></Card>
          :[...activeProject.commitments].reverse().map(c=>{
            const member=members.find(m=>m.id===c.member_id);
            return(
              <Card key={c.id}>
                <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                  <span style={{fontSize:"14px",flexShrink:0,marginTop:1,color:c.status==="open"?T.warning:T.success}}>{c.status==="open"?"●":"✓"}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <p style={{margin:"0 0 4px",fontSize:"13px",color:T.ink,lineHeight:1.4}}>{c.commitment_text}</p>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      {member&&<Tag color={avatarBg(member.name)}>{member.name}</Tag>}
                      <span style={{fontSize:"11px",color:T.muted}}>{fmt(c.date)}</span>
                      <span style={{fontSize:"11px",color:c.status==="open"?T.warning:T.success,fontWeight:600}}>{c.status}</span>
                    </div>
                  </div>
                  {c.status==="open"&&<button onClick={()=>db.updateCommitmentStatus(c.id,"done").then(reload)} style={{background:"none",border:"none",fontSize:"11px",color:T.success,cursor:"pointer",padding:0,flexShrink:0,whiteSpace:"nowrap"}}>Mark done</button>}
                </div>
              </Card>
            );
          })
      )}

      {activeProjectTab==="risks"&&(
        (activeProject.risks||[]).filter(r=>!r.dismissed).length===0
          ?<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No active risks. Risks are auto-detected from meeting notes.</p></Card>
          :(activeProject.risks||[]).filter(r=>!r.dismissed).map(r=>(
            <Card key={r.id} style={{borderLeft:`3px solid ${r.severity==="high"?T.danger:r.severity==="medium"?T.warning:T.accentMid}`}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <SeverityBadge severity={r.severity}/>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{margin:"0 0 4px",fontSize:"13px",color:T.ink,lineHeight:1.4}}>{r.risk_text}</p>
                  <span style={{fontSize:"11px",color:T.muted}}>{fmt(r.detected_at)}</span>
                </div>
                <button onClick={()=>db.dismissRisk(r.id).then(reload)} style={{background:"none",border:"none",fontSize:"11px",color:T.muted,cursor:"pointer",padding:0,flexShrink:0}}>Dismiss</button>
              </div>
            </Card>
          ))
      )}
    </Shell>
  );

  // ── ADD NOTE ────────────────────────────────────────────────────────────────
  if(view==="addNote") return (
    <Shell maxW={640}>
      <Nav/>
      <button onClick={()=>{setView("project");setNotePhase("input");}} style={{fontSize:"12px",color:T.mid,background:"none",border:"none",cursor:"pointer",padding:"0 0 16px",fontFamily:T.sans}}>← {activeProject?.name}</button>
      {notePhase==="input"&&(
        <NoteTextarea onSubmit={analyseNote} onCancel={()=>{setView("project");setNotePhase("input");}} loading={loading} error={error} projectName={activeProject?.name} meName={data.me||"me"} members={members}/>
      )}
      {notePhase==="clarifying"&&(
        <Card>
          <SectionTitle sub="Checked against existing notes — couldn't be resolved from context.">Clarification Needed</SectionTitle>
          {questions.map((q,i)=>(
            <div key={i} style={{marginBottom:14}}>
              <Label>{i+1}. {q}</Label>
              <input value={answers[i]||""} onChange={e=>setAnswers(a=>({...a,[i]:e.target.value}))} placeholder="Your answer (optional)" style={inp}/>
            </div>
          ))}
          {error&&<p style={{color:T.danger,fontSize:"12px",margin:"0 0 10px"}}>{error}</p>}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <Btn onClick={()=>finaliseNote(notes,answers)} disabled={loading}>{loading?"Saving…":"Submit & Save"}</Btn>
            <Btn variant="secondary" onClick={()=>finaliseNote(notes,{})} disabled={loading}>Skip</Btn>
          </div>
        </Card>
      )}
    </Shell>
  );
}
