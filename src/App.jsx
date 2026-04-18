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
const isThisWeek = iso => {
  const d=new Date(iso), now=new Date(), s=new Date(now);
  const day = now.getDay() || 7;
  s.setDate(now.getDate()-day+1); s.setHours(0,0,0,0);
  const e=new Date(s); e.setDate(s.getDate()+6); e.setHours(23,59,59,999);
  return d>=s && d<=e;
};
const isOverdue = iso => iso && new Date(iso)<new Date() && !isThisWeek(iso);

const RAG_LABELS = { red:"Red", amber:"Amber", green:"Green" };
const RAG_COLORS = { red:"#DC2626", amber:"#F59E0B", green:"#16A34A" };
const RagDot = ({rag, size=10}) => rag
  ? <span style={{display:"inline-block",width:size,height:size,borderRadius:"50%",background:RAG_COLORS[rag],flexShrink:0}} title={RAG_LABELS[rag]}/>
  : null;

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

const sanitiseHtml = html =>
  html.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"")
      .replace(/\son\w+="[^"]*"/gi,"").replace(/\son\w+='[^']*'/gi,"").replace(/javascript:/gi,"");

// ─── DB ───────────────────────────────────────────────────────────────────────
const db = {
  async getUser() { const {data:{user}}=await supabase.auth.getUser(); return user; },

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
      // FIX #6: load ALL risks (including dismissed) so we can wipe & re-evaluate per project
      safe(()=>supabase.from('risks').select('*').eq('user_id',userId).order('detected_at').then(r=>r.data)),
      safe(()=>supabase.from('quality_scores').select('*').eq('user_id',userId).then(r=>r.data)),
    ]);
    const allRisks = risks||[];
    return {
      projects: (projects||[]).map(p=>({
        ...p, statusUpdated:p.status_updated_at,
        rag: p.rag||null, ragOverride: p.rag_override||false,
        deadline: p.deadline||null,
        quietThreshold: p.quiet_threshold||7,
        // FIX #7: include project context
        context: p.context||"",
        notes:(notes||[]).filter(n=>n.project_id===p.id).map(n=>({
          ...n, selfTagged:n.self_tagged,
          taggedMembers:(noteMembers||[]).filter(nm=>nm.note_id===n.id).map(nm=>nm.member_id),
          qualityScore:(qualityScores||[]).find(q=>q.note_id===n.id)||null,
        })),
        decisions:(decisions||[]).filter(d=>d.project_id===p.id),
        commitments:(commitments||[]).filter(c=>c.project_id===p.id),
        // only undismissed shown on project, but all loaded so re-eval can wipe cleanly
        risks: allRisks.filter(r=>r.project_id===p.id && !r.dismissed),
      })),
      members:members||[],
      todos:(todos||[]).map(t=>({...t,dueDate:t.due_date,projectId:t.project_id,doneAt:t.done_at,memberId:t.member_id})),
      // global undismissed risks for Risk Radar
      risks: allRisks.filter(r=>!r.dismissed),
      me:profile?.name||null, tourDone:profile?.tour_done||false,
      homeWeeklySummary:homeSummary?.summary||null, homeWeeklySummaryDate:homeSummary?.updated_at||null,
    };
  },

  async createProject(userId, name, context="", deadline=null) {
    const {data}=await supabase.from('projects').insert({user_id:userId,name,context,deadline:deadline||null}).select().single();
    return {...data,notes:[],decisions:[],commitments:[],risks:[],status:null,statusUpdated:null,rag:null,ragOverride:false,context:context||"",deadline:deadline||null};
  },
  async updateProjectStatus(projectId,status) {
    await supabase.from('projects').update({status,status_updated_at:new Date().toISOString()}).eq('id',projectId);
  },
  // FIX #7: update context
  async updateProjectContext(projectId, context) {
    await supabase.from('projects').update({context}).eq('id',projectId);
  },
  async updateProjectQuietThreshold(projectId, days) {
    await supabase.from('projects').update({quiet_threshold:days}).eq('id',projectId);
  },
  // Goals
  async loadGoals(userId) {
    const {data:goals} = await supabase.from('goals').select('*').eq('user_id',userId).order('created_at',{ascending:false});
    const {data:links} = await supabase.from('project_goals').select('*');
    return {goals:goals||[], links:links||[]};
  },
  async createGoal(userId,{title,description,targetDate,owner}) {
    const {data} = await supabase.from('goals').insert({user_id:userId,title,description,target_date:targetDate||null,owner}).select().single();
    return data;
  },
  async updateGoal(goalId,{title,description,targetDate,owner}) {
    await supabase.from('goals').update({title,description,target_date:targetDate||null,owner}).eq('id',goalId);
  },
  async deleteGoal(goalId) { await supabase.from('goals').delete().eq('id',goalId); },
  async linkProjectToGoal(goalId,projectId) {
    await supabase.from('project_goals').upsert({goal_id:goalId,project_id:projectId},{onConflict:'goal_id,project_id'});
  },
  async unlinkProjectFromGoal(goalId,projectId) {
    await supabase.from('project_goals').delete().eq('goal_id',goalId).eq('project_id',projectId);
  },
  async updateProjectDeadline(projectId, deadline) {
    await supabase.from('projects').update({deadline:deadline||null}).eq('id',projectId);
  },
  async updateProjectRag(projectId, rag, isOverride=false) {
    await supabase.from('projects').update({rag, rag_override: isOverride}).eq('id', projectId);
  },
  async deleteProject(projectId) {
    await Promise.all([
      supabase.from('risks').delete().eq('project_id',projectId),
      supabase.from('commitments').delete().eq('project_id',projectId),
      supabase.from('decisions').delete().eq('project_id',projectId),
      supabase.from('todos').update({project_id:null}).eq('project_id',projectId),
    ]);
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
    // Also create a task for each commitment so it shows in My Tasks
    const todoInserts=commitments.map(c=>{
      const member=members.find(m=>m.name.toLowerCase()===c.person?.toLowerCase());
      return {user_id:userId,text:c.commitment,due_date:null,project_id:projectId,source:'ai',member_id:member?.id||null};
    });
    if(todoInserts.length>0) await supabase.from('todos').insert(todoInserts);
  },
  async updateCommitmentStatus(commitmentId,status) {
    await supabase.from('commitments').update({status}).eq('id',commitmentId);
  },
  async saveQualityScore(userId,noteId,{score,feedback,breakdown}) {
    await supabase.from('quality_scores').upsert({user_id:userId,note_id:noteId,score,feedback,breakdown});
  },
  // FIX #6: wipe all existing risks for a project then insert fresh ones
  async replaceRisks(userId, projectId, risks) {
    await supabase.from('risks').delete().eq('project_id', projectId);
    if(!risks?.length) return;
    await supabase.from('risks').insert(
      risks.map(r=>({user_id:userId,project_id:projectId,risk_text:r.text,severity:r.severity||'high',dismissed:false,detected_at:new Date().toISOString()}))
    );
  },
  // kept for legacy dismiss from UI
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
  async updateMember(memberId,{name,role}) { await supabase.from('members').update({name,role}).eq('id',memberId); },

  async createTodo(userId,{text,dueDate,projectId,source='manual',memberId}) {
    const {data}=await supabase.from('todos').insert({user_id:userId,text,due_date:dueDate||null,project_id:projectId||null,source,member_id:memberId||null}).select().single();
    return {...data,dueDate:data.due_date,projectId:data.project_id,memberId:data.member_id};
  },
  async toggleTodo(todoId,done) { await supabase.from('todos').update({done,done_at:done?new Date().toISOString():null}).eq('id',todoId); },
  // FIX #3: reassign project tag on a task
  async updateTodoProject(todoId, projectId) {
    await supabase.from('todos').update({project_id: projectId||null}).eq('id',todoId);
  },
  async updateTodo(todoId, {text, dueDate}) {
    await supabase.from('todos').update({text, due_date:dueDate||null}).eq('id',todoId);
  },
  async deleteTodo(todoId) { await supabase.from('todos').delete().eq('id',todoId); },
  async upsertHomeSummary(userId,summary) { await supabase.from('home_summaries').upsert({user_id:userId,summary,updated_at:new Date().toISOString()}); },
  async getDailyFocus(userId) {
    const today = new Date().toISOString().slice(0,10);
    const {data} = await supabase.from('daily_focus').select('*').eq('user_id',userId).eq('focus_date',today).maybeSingle();
    return data;
  },
  async saveDailyFocus(userId, tasks) {
    const today = new Date().toISOString().slice(0,10);
    await supabase.from('daily_focus').upsert({user_id:userId,focus_date:today,tasks:JSON.stringify(tasks),updated_at:new Date().toISOString()},{onConflict:'user_id,focus_date'});
  },
  async saveWeeklyScore(userId, weekStart, score, breakdown) {
    await supabase.from('weekly_scores').upsert({user_id:userId,week_start:weekStart,score,breakdown:JSON.stringify(breakdown),updated_at:new Date().toISOString()},{onConflict:'user_id,week_start'});
  },
  async getWeeklyScores(userId, limit=10) {
    const {data} = await supabase.from('weekly_scores').select('*').eq('user_id',userId).order('week_start',{ascending:false}).limit(limit);
    return (data||[]).map(r=>({...r,breakdown:r.breakdown?JSON.parse(r.breakdown):{}}));
  },
  async getDailyFocusRange(userId, days=14) {
    const since = new Date(); since.setDate(since.getDate()-days);
    const {data} = await supabase.from('daily_focus').select('*').eq('user_id',userId).gte('focus_date',since.toISOString().slice(0,10)).order('focus_date',{ascending:false});
    return data||[];
  },
  async setName(userId,name) { await supabase.from('profiles').upsert({id:userId,name}); },
  async completeTour(userId) { await supabase.from('profiles').update({tour_done:true}).eq('id',userId); },

  async createShareToken(userId, memberId) {
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const {data} = await supabase.from('share_tokens')
      .upsert({user_id:userId, member_id:memberId, token}, {onConflict:'member_id'})
      .select().single();
    return data?.token || token;
  },
  async getShareData(token) {
    const {data:tokenRow} = await supabase.from('share_tokens').select('*').eq('token',token).maybeSingle();
    if(!tokenRow) return null;
    const {member_id, user_id} = tokenRow;
    const [{data:member},{data:todos},{data:projects}] = await Promise.all([
      supabase.from('members').select('*').eq('id',member_id).single(),
      supabase.from('todos').select('*').eq('user_id',user_id).eq('member_id',member_id).order('created_at'),
      supabase.from('projects').select('id,name').eq('user_id',user_id),
    ]);
    return { member, todos:(todos||[]).map(t=>({...t,dueDate:t.due_date,projectId:t.project_id})), projects:projects||[] };
  },
  async toggleSharedTodo(todoId, done) {
    await supabase.from('todos').update({done, done_at:done?new Date().toISOString():null}).eq('id',todoId);
  },
};

// ─── UI Primitives ────────────────────────────────────────────────────────────
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
    <div style={{maxWidth:maxW,margin:"0 auto",padding:"28px 16px 140px",boxSizing:"border-box"}}>{children}</div>
    <div style={{textAlign:"center",padding:"16px",fontSize:"11px",color:T.muted,borderTop:`1px solid ${T.border}`,marginBottom:64}}>
      <a href="/privacy.html" style={{color:T.muted,marginRight:16}}>Privacy Policy</a>
      <a href="/terms.html" style={{color:T.muted,marginRight:16}}>Terms of Service</a>
      <a href="/refund.html" style={{color:T.muted,marginRight:16}}>Refund Policy</a>
      <span onClick={()=>{}} style={{color:T.muted,cursor:"pointer"}} id="pricing-link">Pricing</span>
    </div>
  </div>
);

const GroupLabel = ({children,color=T.mid}) => (
  <p style={{margin:"14px 0 6px",fontSize:"10px",fontWeight:700,letterSpacing:"0.09em",textTransform:"uppercase",color}}>{children}</p>
);

const Logo = ({onClick}) => (
  <div onClick={onClick} style={{display:"flex",alignItems:"center",gap:7,cursor:onClick?"pointer":"default"}}>
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

const Toast = ({message,onDone}) => {
  useEffect(()=>{const t=setTimeout(onDone,2200);return()=>clearTimeout(t);},[]);
  return <div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",background:T.ink,color:"#fff",padding:"9px 18px",borderRadius:4,fontSize:"13px",fontFamily:T.sans,zIndex:2000,whiteSpace:"nowrap",boxShadow:"0 4px 16px rgba(0,0,0,0.18)"}}>{message}</div>;
};

// ─── RAG Override Picker ──────────────────────────────────────────────────────
const RagPicker = ({current, onSelect, onClose}) => (
  <div style={{position:"fixed",inset:0,zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
    <div style={{background:T.white,border:`1px solid ${T.border}`,borderRadius:4,padding:"16px",boxShadow:"0 4px 20px rgba(0,0,0,0.12)",minWidth:200}} onClick={e=>e.stopPropagation()}>
      <p style={{margin:"0 0 10px",fontSize:"11px",fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:T.mid}}>Set Health Status</p>
      {["green","amber","red"].map(r=>(
        <button key={r} onClick={()=>{onSelect(r);onClose();}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"8px 10px",background:current===r?T.accentLight:"transparent",border:"none",borderRadius:2,cursor:"pointer",fontFamily:T.sans,marginBottom:4}}>
          <RagDot rag={r} size={12}/>
          <span style={{fontSize:"13px",color:T.ink,fontWeight:current===r?600:400}}>{RAG_LABELS[r]}</span>
          {current===r&&<span style={{marginLeft:"auto",fontSize:"11px",color:T.accentMid}}>current</span>}
        </button>
      ))}
    </div>
  </div>
);

// FIX #3: Project tag picker for reassigning a task's project
const ProjectTagPicker = ({projects, currentProjectId, onSelect, onClose}) => (
  <div style={{position:"fixed",inset:0,zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
    <div style={{background:T.white,border:`1px solid ${T.border}`,borderRadius:4,padding:"16px",boxShadow:"0 4px 20px rgba(0,0,0,0.12)",minWidth:220,maxHeight:320,overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
      <p style={{margin:"0 0 10px",fontSize:"11px",fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:T.mid}}>Assign to Project</p>
      <button onClick={()=>{onSelect(null);onClose();}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"8px 10px",background:!currentProjectId?T.accentLight:"transparent",border:"none",borderRadius:2,cursor:"pointer",fontFamily:T.sans,marginBottom:4}}>
        <span style={{fontSize:"13px",color:!currentProjectId?T.accent:T.mid,fontWeight:!currentProjectId?600:400}}>No project</span>
      </button>
      {projects.map((p,i)=>(
        <button key={p.id} onClick={()=>{onSelect(p.id);onClose();}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"8px 10px",background:currentProjectId===p.id?T.accentLight:"transparent",border:"none",borderRadius:2,cursor:"pointer",fontFamily:T.sans,marginBottom:4}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:pc(i),flexShrink:0}}/>
          <span style={{fontSize:"13px",color:T.ink,fontWeight:currentProjectId===p.id?600:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
          {currentProjectId===p.id&&<span style={{marginLeft:"auto",fontSize:"11px",color:T.accentMid,flexShrink:0}}>current</span>}
        </button>
      ))}
    </div>
  </div>
);

// ─── Pre-meeting Briefing Modal ───────────────────────────────────────────────
const PreMeetingBriefing = ({project, todos, members, onClose}) => {
  const [briefing, setBriefing] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(()=>{
    const generate = async () => {
      try {
        const lastNote = [...(project.notes||[])].sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
        const openTasks = todos.filter(t=>!t.done && t.projectId===project.id);
        const openCommitments = (project.commitments||[]).filter(c=>c.status==="open");
        const openDecisions = (project.decisions||[]).slice(-5);
        const activeRisks = (project.risks||[]).filter(r=>!r.dismissed);
        const prompt = `You are preparing someone for a meeting on the project "${project.name}". Write a concise pre-meeting briefing. Be direct — no fluff.
${project.context ? `\nProject context: ${project.context}\n` : ""}
Format exactly:
## What happened last time
[One paragraph summary of the last meeting. If no notes, say "No previous notes."]

## Open tasks going in
[Bullet list of open tasks. If none, say "None."]

## Pending decisions
[Bullet list of unresolved decisions. If none, say "None."]

## Watch out for
[1-3 bullet points: active risks, stale commitments, or things that could derail this meeting. Be specific.]

## Your focus for this meeting
[One sentence — what the person should aim to achieve or clarify today.]

---
Last meeting notes:
${lastNote ? `[${fmt(lastNote.date)}]\n${lastNote.summary}` : "No previous meeting notes."}

Open tasks (${openTasks.length}):
${openTasks.length > 0 ? openTasks.map(t=>`- ${t.text}${t.dueDate?` (due ${fmtShort(t.dueDate)})`:""}`).join("\n") : "None"}

Open commitments (${openCommitments.length}):
${openCommitments.length > 0 ? openCommitments.map(c=>{const m=members.find(mm=>mm.id===c.member_id);return `- ${m?.name||"Someone"}: ${c.commitment_text}`;}).join("\n") : "None"}

Recent decisions:
${openDecisions.length > 0 ? openDecisions.map(d=>`- ${d.decision_text}`).join("\n") : "None"}

Active risks:
${activeRisks.length > 0 ? activeRisks.map(r=>`- [${r.severity}] ${r.risk_text}`).join("\n") : "None"}`;
        const result = await claude(prompt, 800);
        setBriefing(result);
      } catch { setBriefing("Failed to generate briefing. Please try again."); }
      finally { setLoading(false); }
    };
    generate();
  }, []);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:T.white,borderRadius:4,width:"100%",maxWidth:580,maxHeight:"90vh",overflowY:"auto",fontFamily:T.sans}}>
        <div style={{padding:"18px 20px 14px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,background:T.white,zIndex:1}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:"16px"}}>⚡</span>
              <h2 style={{margin:0,fontFamily:T.serif,fontSize:"17px",fontWeight:700,color:T.ink}}>Pre-meeting Briefing</h2>
            </div>
            <p style={{margin:"2px 0 0",fontSize:"12px",color:T.muted}}>{project.name}</p>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:T.muted,fontSize:20,cursor:"pointer",padding:0}}>✕</button>
        </div>
        <div style={{padding:"18px 20px"}}>
          {loading
            ? <div style={{display:"flex",flexDirection:"column",gap:8,alignItems:"center",padding:"32px 0"}}>
                <div style={{width:28,height:28,border:`2px solid ${T.border}`,borderTop:`2px solid ${T.accent}`,borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                <p style={{color:T.muted,fontSize:"13px",margin:0}}>Preparing your briefing…</p>
              </div>
            : <MD content={briefing}/>}
        </div>
      </div>
    </div>
  );
};

// ─── Shared Task View (public, no login) ──────────────────────────────────────
const SharedTaskView = ({token}) => {
  const [shareData, setShareData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [todos, setTodos] = useState([]);
  const [toast, setToast] = useState(null);
  useEffect(()=>{ db.getShareData(token).then(d=>{ if(d){ setShareData(d); setTodos(d.todos); } setLoading(false); }); },[token]);
  const toggle = async id => {
    const todo = todos.find(t=>t.id===id); if(!todo) return;
    const nowDone = !todo.done;
    await db.toggleSharedTodo(id, nowDone);
    setTodos(ts => ts.map(t=>t.id===id ? {...t,done:nowDone} : t));
    setToast(nowDone ? "Marked done ✓" : "Marked pending");
  };
  if(loading) return <Shell maxW={500}><div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"60vh"}}><p style={{color:T.muted}}>Loading…</p></div></Shell>;
  if(!shareData) return <Shell maxW={500}><div style={{paddingTop:60,textAlign:"center"}}><Logo/><p style={{color:T.mid,marginTop:24,fontSize:"14px"}}>This link is invalid or has expired.</p></div></Shell>;
  const {member, projects} = shareData;
  const pending = todos.filter(t=>!t.done);
  const done = todos.filter(t=>t.done);
  const overdue = pending.filter(t=>isOverdue(t.dueDate));
  return (
    <Shell maxW={560}>
      {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
      <div style={{marginBottom:24,paddingBottom:14,borderBottom:`1px solid ${T.border}`}}><Logo/></div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <Av name={member.name} size={44}/>
        <div><h1 style={{margin:0,fontFamily:T.serif,fontSize:"20px",fontWeight:700,color:T.ink}}>{member.name}</h1>{member.role&&<p style={{margin:"2px 0 0",fontSize:"13px",color:T.mid}}>{member.role}</p>}</div>
      </div>
      {overdue.length>0&&(
        <Card style={{borderLeft:`3px solid ${T.danger}`,marginBottom:10}}>
          <p style={{margin:"0 0 8px",fontSize:"11px",fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:T.danger}}>Overdue ({overdue.length})</p>
          {overdue.map(t=>{ const proj=projects.find(p=>p.id===t.projectId); return (
            <div key={t.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 0",borderBottom:`1px solid ${T.border}`}}>
              <input type="checkbox" checked={!!t.done} onChange={()=>toggle(t.id)} style={{marginTop:3,accentColor:T.accent,cursor:"pointer",flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <p style={{margin:0,fontSize:"13px",color:T.ink,lineHeight:1.5}}>{t.text}</p>
                <div style={{display:"flex",gap:5,marginTop:3,flexWrap:"wrap"}}>
                  {proj&&<Tag color={T.accentMid}>{proj.name}</Tag>}
                  <span style={{fontSize:"11px",color:T.danger,fontWeight:600}}>Overdue · {fmtShort(t.dueDate)}</span>
                </div>
              </div>
            </div>
          );})}
        </Card>
      )}
      <Card>
        <p style={{margin:"0 0 8px",fontSize:"11px",fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:T.mid}}>Open Tasks ({pending.filter(t=>!isOverdue(t.dueDate)).length})</p>
        {pending.filter(t=>!isOverdue(t.dueDate)).length===0 ? <p style={{color:T.muted,fontSize:"13px",margin:0}}>No open tasks.</p>
          : pending.filter(t=>!isOverdue(t.dueDate)).map(t=>{ const proj=projects.find(p=>p.id===t.projectId); return (
            <div key={t.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 0",borderBottom:`1px solid ${T.border}`}}>
              <input type="checkbox" checked={!!t.done} onChange={()=>toggle(t.id)} style={{marginTop:3,accentColor:T.accent,cursor:"pointer",flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <p style={{margin:0,fontSize:"13px",color:T.ink,lineHeight:1.5}}>{t.text}</p>
                <div style={{display:"flex",gap:5,marginTop:3,flexWrap:"wrap"}}>
                  {proj&&<Tag color={T.accentMid}>{proj.name}</Tag>}
                  {t.dueDate&&<span style={{fontSize:"11px",color:T.muted}}>{fmtShort(t.dueDate)}</span>}
                </div>
              </div>
            </div>
          );})}
      </Card>
      {done.length>0&&(
        <Card style={{marginTop:6}}>
          <p style={{margin:"0 0 8px",fontSize:"11px",fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:T.muted}}>Completed ({done.length})</p>
          {done.map(t=>(
            <div key={t.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"6px 0",borderBottom:`1px solid ${T.border}`}}>
              <input type="checkbox" checked onChange={()=>toggle(t.id)} style={{marginTop:3,accentColor:T.accent,cursor:"pointer",flexShrink:0}}/>
              <p style={{margin:0,fontSize:"13px",color:T.muted,textDecoration:"line-through",lineHeight:1.5}}>{t.text}</p>
            </div>
          ))}
        </Card>
      )}
      <p style={{textAlign:"center",fontSize:"11px",color:T.muted,marginTop:24}}>Powered by Debrief</p>
    </Shell>
  );
};

// ─── Meeting Templates ────────────────────────────────────────────────────────
const TEMPLATES = [
  { id:"standup", label:"Standup", icon:"☀️", structure:`STANDUP – [Date]\nAttendees: \n\nYESTERDAY:\n- \n\nTODAY:\n- \n\nBLOCKERS:\n- \n\n@[YourName] action items:\n- ` },
  { id:"client_call", label:"Client Call", icon:"📞", structure:`CLIENT CALL – [Date]\nClient: \nAttendees: \n\nAGENDA COVERED:\n- \n\nKEY DECISIONS:\n- \n\nCLIENT FEEDBACK:\n- \n\nNEXT STEPS:\n- @[YourName] to \n- Client to \n\nFOLLOW-UP DATE: ` },
  { id:"sprint_review", label:"Sprint Review", icon:"🔄", structure:`SPRINT REVIEW – [Date]\nSprint: \nAttendees: \n\nCOMPLETED:\n- \n\nNOT COMPLETED (carried over):\n- \n\nDEMO FEEDBACK:\n- \n\nRETROSPECTIVE:\n- What went well: \n- What didn't: \n- Action: @[YourName] to \n\nNEXT SPRINT PRIORITIES:\n1. \n2. \n3. ` },
  { id:"one_on_one", label:"1:1", icon:"👥", structure:`1:1 – [Date]\nWith: \n\nTHEIR UPDATE:\n- \n\nCONCERNS / BLOCKERS RAISED:\n- \n\nFEEDBACK GIVEN:\n- \n\nCOMMITMENTS MADE:\n- [Name] to \n- [Name] to \n\nNEXT 1:1: ` },
  { id:"board_update", label:"Board / Exec", icon:"📊", structure:`BOARD / EXEC UPDATE – [Date]\nAttendees: \n\nPRESENTED:\n- \n\nKEY DECISIONS MADE:\n- \n\nRISKS FLAGGED:\n- \n\nASKS / APPROVALS:\n- \n\nACTION OWNERS:\n- @[YourName] to \n- \n\nNEXT REVIEW: ` },
  { id:"personal", label:"My Notes", icon:"🧠", structure:`MY NOTES – [Date]\nContext / meeting: \n\nWHAT I'M THINKING:\n- \n\nKEY OBSERVATIONS:\n- \n\nOPEN QUESTIONS:\n- \n\nWHAT I WANT TO DO ABOUT IT:\n- @[YourName] to \n\nHUNCH / INSTINCT:\n` },
];

// ─── Bottom Search Bar ────────────────────────────────────────────────────────
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
  const [q,setQ]=useState(""); const [mode,setMode]=useState("search"); const [askAnswer,setAskAnswer]=useState(""); const [asking,setAsking]=useState(false);
  const inputRef=useRef(null);
  useEffect(()=>{ setTimeout(()=>inputRef.current?.focus(),50); },[]);
  const isQuestion = q.trim().endsWith("?")||/^(what|who|when|why|how|which|did|has|show)\b/i.test(q.trim());
  const results=useMemo(()=>{
    if(!q.trim()||mode==="ask") return [];
    const ql=q.toLowerCase(),hits=[];
    for(const p of projects) for(const n of p.notes)
      if(n.summary?.toLowerCase().includes(ql)||n.raw?.toLowerCase().includes(ql)||p.name.toLowerCase().includes(ql))
        hits.push({note:n,project:p,projIdx:projects.findIndex(pp=>pp.id===p.id)});
    return hits.slice(0,15);
  },[q,projects,mode]);
  const highlight=(text,q)=>{ if(!q.trim()) return text.slice(0,120); const idx=text.toLowerCase().indexOf(q.toLowerCase()); if(idx===-1) return text.slice(0,120); const start=Math.max(0,idx-40); return (start>0?"…":"")+text.slice(start,start+160)+(start+160<text.length?"…":""); };
  const handleAsk=async()=>{
    if(!q.trim()) return; setAsking(true);setAskAnswer("");setMode("ask");
    try{
      const projectSummaries=projects.map(p=>`Project: ${p.name} | RAG:${p.rag||"unknown"} | deadline:${p.deadline||"none"} | notes:${p.notes.length} | last note:${p.notes.length>0?fmt([...p.notes].sort((a,b)=>new Date(b.date)-new Date(a.date))[0].date):"never"}`);
      const ctx=[
        "PROJECTS:\n"+projectSummaries.join("\n"),
        "DECISIONS:\n"+projects.flatMap(p=>(p.decisions||[]).map(d=>`[${p.name}] ${d.decision_text} (${fmt(d.date)})`)).join("\n"),
        "COMMITMENTS:\n"+projects.flatMap(p=>(p.commitments||[]).map(c=>`[${p.name}] ${members.find(m=>m.id===c.member_id)?.name||"Someone"}: ${c.commitment_text} (${c.status}, ${fmt(c.date)})`)).join("\n"),
        "RISKS:\n"+projects.flatMap(p=>(p.risks||[]).filter(r=>!r.dismissed).map(r=>`[${p.name}] ${r.severity}: ${r.risk_text}`)).join("\n"),
        "TASKS:\n"+todos.map(t=>{const p=projects.find(pp=>pp.id===t.projectId);return `${t.text} | ${p?.name||"no project"} | ${t.done?"done":"open"} | due:${t.dueDate||"none"}`;}).join("\n"),
        "MEETING NOTES:\n"+projects.flatMap(p=>p.notes.map(n=>`[${p.name}] ${fmt(n.date)}:\n${n.summary}`)).join("\n\n"),
      ].join("\n\n");
      const answer=await claude(`You are Debrief AI — a smart project intelligence assistant. You have full access to the user's projects, decisions, commitments, risks, tasks and meeting notes below. Answer questions directly and specifically. For scenario questions ("what happens if..."), reason through dependencies and give a specific impact assessment. For status queries ("who hasn't...", "which projects are..."), scan the data precisely. Never say you don't have access — you do.\n\nQuestion: ${q}\n\nData:\n${ctx}`,1000);
      setAskAnswer(answer);
    }catch{setAskAnswer("Sorry, couldn't get an answer. Please try again.");}
    finally{setAsking(false);}
  };
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",flexDirection:"column"}} onClick={onClose}>
      <div style={{background:T.white,margin:"20px 16px 0",borderRadius:4,padding:"12px 16px",display:"flex",gap:10,alignItems:"center"}} onClick={e=>e.stopPropagation()}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke={T.muted} strokeWidth="1.5"/><path d="M9.5 9.5L12 12" stroke={T.muted} strokeWidth="1.5" strokeLinecap="round"/></svg>
        <input ref={inputRef} value={q} onChange={e=>{setQ(e.target.value);setMode("search");setAskAnswer("");}} onKeyDown={e=>e.key==="Enter"&&isQuestion&&handleAsk()}
          placeholder="Ask anything: 'Who hasn't closed a commitment in 14 days?' or 'What happens if Rahul is delayed?'"
          style={{flex:1,border:"none",outline:"none",fontSize:"14px",color:T.ink,fontFamily:T.sans,background:"transparent"}}/>
        {isQuestion&&q.trim()&&<button onClick={handleAsk} disabled={asking} style={{padding:"4px 12px",fontSize:"12px",background:T.accent,color:"#fff",border:"none",borderRadius:2,cursor:"pointer",flexShrink:0,fontFamily:T.sans}}>{asking?"Asking…":"Ask AI"}</button>}
        <button onClick={onClose} style={{background:"none",border:"none",color:T.muted,fontSize:18,cursor:"pointer",padding:0}}>✕</button>
      </div>
      <div style={{flex:1,overflowY:"auto",margin:"8px 16px 16px"}} onClick={e=>e.stopPropagation()}>
        {mode==="ask"&&<div style={{background:T.white,borderRadius:4,padding:"16px"}}><p style={{margin:"0 0 8px",fontSize:"11px",fontWeight:700,letterSpacing:"0.06em",color:T.muted,textTransform:"uppercase"}}>AI Answer</p>{asking?<p style={{color:T.mid,fontSize:"14px"}}>Searching your notes…</p>:<MD content={askAnswer} small/>}</div>}
        {mode==="search"&&results.map((r,i)=>(
          <div key={i} onClick={()=>{onProjectNav(r.projIdx);onClose();}} style={{background:T.white,borderRadius:4,padding:"14px 16px",marginBottom:6,cursor:"pointer",borderLeft:`3px solid ${pc(r.projIdx)}`}}>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}><Tag color={pc(r.projIdx)}>{r.project.name}</Tag><span style={{fontSize:"11px",color:T.muted}}>{fmt(r.note.date)}</span></div>
            <p style={{margin:0,fontSize:"13px",color:T.mid,lineHeight:1.5,textAlign:"left"}}>{highlight(r.note.summary?.replace(/[#*]/g,"")||r.note.raw||"",q)}</p>
          </div>
        ))}
        {mode==="search"&&q.trim()&&results.length===0&&<div style={{background:T.white,borderRadius:4,padding:"24px",textAlign:"center",color:T.muted,fontSize:"14px"}}>No results. Try asking a question — type "?" at the end.</div>}
        {!q.trim()&&<div style={{background:T.white,borderRadius:4,padding:"20px 16px"}}>
          <p style={{margin:"0 0 12px",fontSize:"11px",fontWeight:700,letterSpacing:"0.06em",color:T.muted,textTransform:"uppercase"}}>Try asking</p>
          {["Who hasn't closed a commitment in 14 days?","Which projects have gone quiet this week?","What happens if Rahul doesn't deliver this week?","Show me all decisions we made about vendors","Which project is most at risk of slipping?"].map((s,i)=>(
            <button key={i} onClick={()=>{setQ(s);setTimeout(()=>handleAsk(),100);}} style={{display:"block",width:"100%",textAlign:"left",padding:"8px 0",fontSize:"13px",color:T.accentMid,background:"none",border:"none",borderBottom:`1px solid ${T.border}`,cursor:"pointer",fontFamily:T.sans}}>{s}</button>
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
        {saving&&<p style={{fontSize:"12px",color:T.accentMid,margin:"8px 0 0"}}>Regenerating summary…</p>}
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
const Tour=({onDone})=>{
  const [step,setStep]=useState(0); const [pos,setPos]=useState(null); const isMobile=window.innerWidth<600;
  useEffect(()=>{
    const position=()=>{ const el=document.getElementById(TOUR_STEPS[step].target); if(!el)return; const r=el.getBoundingClientRect(); setPos({top:r.bottom+10,left:Math.min(r.left,window.innerWidth-280)}); };
    position(); window.addEventListener('resize',position); window.addEventListener('scroll',position,true);
    return()=>{ window.removeEventListener('resize',position); window.removeEventListener('scroll',position,true); };
  },[step]);
  const next=()=>{if(step<TOUR_STEPS.length-1)setStep(s=>s+1);else onDone();}; const prev=()=>{if(step>0)setStep(s=>s-1);}; const curr=TOUR_STEPS[step];
  if(isMobile) return(<><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:999}} onClick={onDone}/><div style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",padding:"24px 20px 36px",zIndex:1000,fontFamily:T.sans}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><span style={{fontSize:"11px",fontWeight:700,letterSpacing:"0.07em",color:T.muted,textTransform:"uppercase"}}>Step {step+1} of {TOUR_STEPS.length}</span><button onClick={onDone} style={{background:"none",border:"none",color:T.muted,fontSize:18,cursor:"pointer",padding:0}}>✕</button></div><h3 style={{margin:"0 0 8px",fontSize:"18px",fontWeight:700,fontFamily:T.serif,color:T.ink,textAlign:"left"}}>{curr.title}</h3><p style={{margin:"0 0 20px",fontSize:"14px",color:T.mid,lineHeight:1.6,textAlign:"left"}}>{curr.body}</p><div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><div style={{display:"flex",gap:5}}>{TOUR_STEPS.map((_,i)=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:i===step?T.accent:T.border}}/>)}</div><div style={{display:"flex",gap:8}}>{step>0&&<button onClick={prev} style={{padding:"8px 16px",fontSize:"13px",border:`1px solid ${T.border}`,borderRadius:4,background:"transparent",color:T.ink,cursor:"pointer"}}>← Back</button>}<button onClick={next} style={{padding:"8px 20px",fontSize:"13px",border:"none",borderRadius:4,background:T.accent,color:"#fff",fontWeight:600,cursor:"pointer"}}>{step===TOUR_STEPS.length-1?"Got it ✓":"Next →"}</button></div></div></div></>);
  return(<><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.25)",zIndex:999}} onClick={onDone}/>{pos&&<div style={{position:"fixed",top:pos.top,left:pos.left,width:260,background:T.accent,color:"#fff",borderRadius:8,padding:"14px 16px",zIndex:1000,fontFamily:T.sans,boxSizing:"border-box"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}><span style={{fontSize:"13px",fontWeight:700}}>{curr.title}</span><button onClick={onDone} style={{background:"none",border:"none",color:"rgba(255,255,255,0.6)",fontSize:14,cursor:"pointer",padding:0,marginLeft:8,flexShrink:0}}>✕</button></div><p style={{margin:"0 0 14px",fontSize:"13px",lineHeight:1.6,color:"rgba(255,255,255,0.85)",textAlign:"left"}}>{curr.body}</p><div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><div style={{display:"flex",gap:4}}>{TOUR_STEPS.map((_,i)=><div key={i} style={{width:5,height:5,borderRadius:"50%",background:i===step?"#fff":"rgba(255,255,255,0.35)"}}/>)}</div><div style={{display:"flex",gap:6}}>{step>0&&<button onClick={prev} style={{padding:"4px 10px",fontSize:"11px",border:"1px solid rgba(255,255,255,0.3)",borderRadius:3,background:"transparent",color:"#fff",cursor:"pointer"}}>← Back</button>}<button onClick={next} style={{padding:"4px 12px",fontSize:"11px",border:"none",borderRadius:3,background:"rgba(255,255,255,0.2)",color:"#fff",fontWeight:600,cursor:"pointer"}}>{step===TOUR_STEPS.length-1?"Got it ✓":"Next →"}</button></div></div><div style={{position:"absolute",top:-6,left:16,width:0,height:0,borderLeft:"6px solid transparent",borderRight:"6px solid transparent",borderBottom:`6px solid ${T.accent}`}}/></div>}</>);
};

// ─── Note Textarea ────────────────────────────────────────────────────────────
const NoteTextarea=({onSubmit,onCancel,loading,error,projectName,meName,members})=>{
  const ref=useRef(null); const [show,setShow]=useState(false); const [q,setQ]=useState(""); const [dropPos,setDropPos]=useState(0);
  const all=useMemo(()=>[{id:"me",name:meName,isSelf:true},...members.map(m=>({...m,isSelf:false}))],[meName,members]);
  const filtered=all.filter(m=>m.name.toLowerCase().includes(q.toLowerCase()));
  const handleChange=e=>{const val=e.target.value,cur=e.target.selectionStart,before=val.slice(0,cur);const match=before.match(/@([\w][\w ]*)$/);if(match){setQ(match[1]);setShow(true);setDropPos(cur-match[0].length);}else setShow(false);};
  const insert=name=>{const ta=ref.current,val=ta.value,before=val.slice(0,dropPos),rest=val.slice(dropPos).replace(/^@[\w ]*/,"");ta.value=before+`@${name}`+(rest.startsWith(" ")?rest:" "+rest);setShow(false);ta.focus();};
  const applyTemplate=tmpl=>{ ref.current.value=tmpl.structure.replace(/\[YourName\]/g,meName); ref.current.focus(); };
  return (
    <Card>
      <div style={{marginBottom:14}}>
        <h2 style={{margin:0,fontSize:"18px",fontWeight:700,fontFamily:T.serif,color:T.ink}}>Add Meeting Notes</h2>
        <p style={{margin:"2px 0 0",fontSize:"12px",color:T.muted}}>Saving to: {projectName}</p>
      </div>
      <p style={{fontSize:"12px",color:T.muted,margin:"0 0 8px"}}>Type @ to tag people. Decisions, commitments and risks will be auto-extracted.</p>
      <div style={{marginBottom:10}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:"11px",color:T.muted,fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase"}}>Template:</span>
          {TEMPLATES.map(tmpl=>(
            <button key={tmpl.id} onClick={()=>applyTemplate(tmpl)} style={{padding:"3px 10px",fontSize:"11px",border:`1px solid ${T.border}`,borderRadius:2,background:"transparent",color:T.mid,cursor:"pointer",fontFamily:T.sans,display:"flex",alignItems:"center",gap:4}}>
              <span>{tmpl.icon}</span>{tmpl.label}
            </button>
          ))}
          <button onClick={()=>{ref.current.value="";ref.current.focus();}} style={{padding:"3px 10px",fontSize:"11px",border:`1px solid ${T.border}`,borderRadius:2,background:"transparent",color:T.muted,cursor:"pointer",fontFamily:T.sans}}>Clear</button>
        </div>
      </div>
      <div style={{position:"relative"}}>
        <textarea ref={ref} onChange={handleChange} placeholder="Paste raw notes, transcript, or pick a template above…" style={{...inp,height:200,resize:"vertical",lineHeight:1.65}}/>
        {show&&filtered.length>0&&(
          <div style={{position:"absolute",top:"100%",left:0,right:0,background:T.white,border:`1px solid ${T.border}`,borderRadius:2,boxShadow:"0 4px 12px rgba(0,0,0,0.08)",zIndex:20}}>
            {filtered.map(m=>(<div key={m.id} onMouseDown={e=>{e.preventDefault();insert(m.name);}} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",cursor:"pointer",fontSize:"13px",color:T.ink,borderBottom:`1px solid ${T.border}`}}><Av name={m.name} size={20} isSelf={m.isSelf}/>{m.name}{m.isSelf&&" (you)"}</div>))}
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

// ─── Todo Item (FIX #3: project tag click opens reassign picker) ──────────────
const TodoItem=({todo,projects,members,onToggle,onDelete,onProjectNav,onReassignProject,onEdit})=>{
  const proj=todo.projectId?projects.find(p=>p.id===todo.projectId):null;
  const projIdx=proj?projects.findIndex(p=>p.id===todo.projectId):-1;
  const assignedMember=todo.memberId?members.find(m=>m.id===todo.memberId):null;
  const overdue=!todo.done&&isOverdue(todo.dueDate);
  const [editing,setEditing]=useState(false);
  const [editText,setEditText]=useState(todo.text);
  const [editDue,setEditDue]=useState(todo.dueDate||"");
  const saveEdit=async()=>{
    if(!editText.trim())return;
    await onEdit(todo.id,{text:editText.trim(),dueDate:editDue||null});
    setEditing(false);
  };
  if(editing) return (
    <div style={{padding:"9px 0",borderBottom:`1px solid ${T.border}`}}>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"flex-end"}}>
        <input value={editText} onChange={e=>setEditText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveEdit()} autoFocus style={{...inp,flex:"1 1 160px",fontSize:"13px",padding:"6px 9px"}}/>
        <input type="date" value={editDue} onChange={e=>setEditDue(e.target.value)} style={{...inp,width:"auto",fontSize:"12px",padding:"6px 9px"}}/>
        <Btn size="sm" onClick={saveEdit} disabled={!editText.trim()}>Save</Btn>
        <Btn size="sm" variant="secondary" onClick={()=>{setEditing(false);setEditText(todo.text);setEditDue(todo.dueDate||"");}}>Cancel</Btn>
      </div>
    </div>
  );
  return (
    <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 0",borderBottom:`1px solid ${T.border}`}}>
      <input type="checkbox" checked={!!todo.done} onChange={()=>onToggle(todo.id)} style={{marginTop:3,accentColor:T.accent,cursor:"pointer",flexShrink:0}}/>
      <div style={{flex:1,minWidth:0}}>
        <p style={{margin:0,fontSize:"13px",color:T.ink,textDecoration:todo.done?"line-through":"none",lineHeight:1.5,wordBreak:"break-word"}}>{todo.text}</p>
        <div style={{display:"flex",gap:5,marginTop:3,flexWrap:"wrap",alignItems:"center"}}>
          {proj
            ? <span style={{display:"inline-flex",alignItems:"center",gap:3,flexShrink:0}}>
                <Tag color={pc(projIdx)} onClick={()=>onProjectNav&&onProjectNav(projIdx)}>{proj.name}</Tag>
                <span onClick={e=>{e.stopPropagation();onReassignProject&&onReassignProject(todo.id,todo.projectId);}} style={{cursor:"pointer",color:T.muted,fontSize:"11px",paddingLeft:2}} title="Reassign project">✎</span>
              </span>
            : <span onClick={e=>{e.stopPropagation();onReassignProject&&onReassignProject(todo.id,null);}} style={{fontSize:"11px",color:T.muted,cursor:"pointer",borderBottom:`1px dashed ${T.border}`,paddingBottom:1}}>+ assign project</span>
          }
          {assignedMember&&<Tag color={avatarBg(assignedMember.name)}>{assignedMember.name}</Tag>}
          {todo.dueDate&&<span style={{fontSize:"11px",color:overdue?T.danger:T.muted,fontWeight:overdue?600:400}}>{overdue?"Overdue · ":""}{fmtShort(todo.dueDate)}</span>}
          {todo.source==="ai"&&<span style={{fontSize:"10px",color:T.muted,letterSpacing:"0.05em"}}>AUTO</span>}
        </div>
      </div>
      <div style={{display:"flex",gap:2,flexShrink:0}}>
        <button onClick={()=>setEditing(true)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:13,padding:"0 3px"}} title="Edit task">✎</button>
        <button onClick={()=>onDelete(todo.id)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:14,padding:"0 2px"}}>✕</button>
      </div>
    </div>
  );
};

// ─── Inline Add Task (FIX #2: inside project view) ───────────────────────────
const InlineAddTask=({projectId,userId,members,onAdd})=>{
  const [text,setText]=useState(""); const [due,setDue]=useState(""); const [memberId,setMemberId]=useState(""); const [open,setOpen]=useState(false);
  const submit=async()=>{
    if(!text.trim()) return;
    const t=await db.createTodo(userId,{text:text.trim(),dueDate:due||null,projectId,source:'manual',memberId:memberId||null});
    onAdd(t); setText(""); setDue(""); setMemberId(""); setOpen(false);
  };
  if(!open) return <button onClick={()=>setOpen(true)} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 0",fontSize:"13px",color:T.accentMid,background:"none",border:"none",cursor:"pointer",fontFamily:T.sans}}>+ Add task to this project</button>;
  return (
    <div style={{background:T.accentLight,border:`1px solid ${T.accent}20`,borderRadius:2,padding:"12px",marginBottom:10}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div style={{flex:"1 1 160px"}}><input value={text} onChange={e=>setText(e.target.value)} placeholder="Task description…" onKeyDown={e=>e.key==="Enter"&&submit()} style={inp} autoFocus/></div>
        <div style={{flex:"0 0 auto"}}><input type="date" value={due} onChange={e=>setDue(e.target.value)} style={{...inp,width:"auto"}}/></div>
        {members.length>0&&<div style={{flex:"1 1 120px"}}><select value={memberId} onChange={e=>setMemberId(e.target.value)} style={{...inp}}><option value="">Assign to…</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>}
        <Btn onClick={submit} disabled={!text.trim()}>Add</Btn>
        <Btn variant="secondary" onClick={()=>setOpen(false)}>Cancel</Btn>
      </div>
    </div>
  );
};

// ─── Score helpers ────────────────────────────────────────────────────────────
const getWeekStart = (date=new Date()) => {
  const d = new Date(date); const day = d.getDay()||7;
  d.setDate(d.getDate()-day+1); d.setHours(0,0,0,0); return d;
};
const dateInWeek = (isoString, weekStart) => {
  if(!isoString) return false;
  const d = new Date(isoString); const end = new Date(weekStart); end.setDate(end.getDate()+7);
  return d >= weekStart && d < end;
};
const calcScore = (todos, commitments, notes, focusDays) => {
  const ws = getWeekStart();
  // Win Today days this week (max 3 days for 30pts)
  const winDays = focusDays.filter(d=>{
    if(!dateInWeek(d.focus_date+'T00:00:00', ws)) return false;
    try{ const tasks=JSON.parse(d.tasks); return tasks.length>0&&tasks.every(t=>t.done); }catch{ return false; }
  }).length;
  const winPts = Math.min(winDays,3)*10;
  // Tasks done this week (max 40pts)
  const doneTW = todos.filter(t=>t.done&&t.doneAt&&dateInWeek(t.doneAt,ws)).length;
  const taskPts = Math.min(doneTW*5,40);
  // Commitments closed this week (max 20pts)
  const closedTW = commitments.filter(c=>c.status==='done'&&c.date&&dateInWeek(c.date,ws)).length;
  const commitPts = Math.min(closedTW*5,20);
  // Notes added this week (max 10pts, 5pts each, max 2)
  const notesTW = notes.filter(n=>n.date&&dateInWeek(n.date,ws)).length;
  const notesPts = Math.min(notesTW,2)*5;
  const total = winPts+taskPts+commitPts+notesPts;
  return { total, winPts, taskPts, commitPts, notesPts, winDays, doneTW, closedTW, notesTW };
};
const scoreLabel = s => s>=85?"Outstanding week":s>=65?"Strong week":s>=40?"Steady progress":"Room to grow";
const scoreColor = s => s>=65?"#16A34A":s>=40?"#F59E0B":"#DC2626";
// Sparkline — renders 8 tiny bars
const Sparkline = ({scores}) => {
  if(!scores||scores.length<2) return null;
  const vals = [...scores].reverse().slice(-8).map(s=>s.score);
  const max = Math.max(...vals,1);
  return (
    <div style={{display:"flex",gap:2,alignItems:"flex-end",height:20}}>
      {vals.map((v,i)=>(
        <div key={i} style={{width:8,background:scoreColor(v),borderRadius:1,height:`${Math.max(3,Math.round((v/max)*20))}px`,flexShrink:0}}/>
      ))}
    </div>
  );
};

// ─── Debrief Score component ──────────────────────────────────────────────────
// ─── Score Page ───────────────────────────────────────────────────────────────
const ScorePage = ({userId, todos, data, onBack}) => {
  const [scores, setScores] = useState([]);
  const [focusDays, setFocusDays] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(()=>{
    if(!userId) return;
    const load = async () => {
      const [weeklyScores, days] = await Promise.all([
        db.getWeeklyScores(userId, 12),
        db.getDailyFocusRange(userId, 90),
      ]);
      const allCommitments = (data?.projects||[]).flatMap(p=>p.commitments||[]);
      const allNotes = (data?.projects||[]).flatMap(p=>p.notes||[]);
      const breakdown = calcScore(todos, allCommitments, allNotes, days);
      const ws = getWeekStart().toISOString().slice(0,10);
      await db.saveWeeklyScore(userId, ws, breakdown.total, breakdown);
      const existing = weeklyScores.filter(s=>s.week_start!==ws);
      const all = [{week_start:ws,score:breakdown.total,breakdown},...existing];
      setScores(all); setFocusDays(days); setLoaded(true);
    };
    load();
  },[userId]);

  // Compute streak
  const {cur:streak, best:bestStreak} = (() => {
    let cur=0,best=0,prev=null;
    for(const d of [...focusDays].sort((a,b)=>b.focus_date.localeCompare(a.focus_date))){
      let allDone=false;
      try{ const t=JSON.parse(d.tasks); allDone=t.length>0&&t.every(x=>x.done); }catch{}
      if(allDone){
        if(prev===null){ const today=new Date().toISOString().slice(0,10); const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10); cur=(d.focus_date===today||d.focus_date===yesterday)?1:0; }
        else{ const exp=new Date(prev); exp.setDate(exp.getDate()-1); cur=d.focus_date===exp.toISOString().slice(0,10)?cur+1:0; }
        if(cur>best)best=cur; prev=d.focus_date;
      } else { if(cur>best)best=cur; cur=0; prev=d.focus_date; }
    }
    return {cur,best:Math.max(best,cur)};
  })();

  const thisWeek = scores[0];
  const lastWeek = scores[1];
  const s = thisWeek?.score||0;
  const b = thisWeek?.breakdown||{};
  const delta = thisWeek&&lastWeek ? thisWeek.score-lastWeek.score : null;
  const totalTasksDone = todos.filter(t=>t.done&&t.doneAt).length;
  const totalNotes = (data?.projects||[]).flatMap(p=>p.notes||[]).length;

  return (
    <Shell>
      <div style={{marginBottom:24,paddingBottom:14,borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <Logo onClick={onBack}/>
        <button onClick={onBack} style={{fontSize:"12px",color:T.mid,background:"none",border:"none",cursor:"pointer",fontFamily:T.sans}}>← Back</button>
      </div>

      {!loaded ? <p style={{color:T.muted,fontSize:"13px"}}>Loading your score…</p> : <>
        {/* Hero score */}
        <div style={{textAlign:"center",padding:"24px 0 20px"}}>
          <div style={{fontSize:"64px",fontWeight:700,color:scoreColor(s),lineHeight:1}}>{s}</div>
          <div style={{fontSize:"15px",fontWeight:600,color:scoreColor(s),marginTop:4}}>{scoreLabel(s)}</div>
          {delta!==null&&<div style={{fontSize:"12px",color:delta>=0?T.success:T.danger,marginTop:6}}>{delta>=0?`↑${delta} pts vs last week`:`↓${Math.abs(delta)} pts vs last week`}</div>}
          <div style={{display:"flex",justifyContent:"center",gap:24,marginTop:16}}>
            <div style={{textAlign:"center"}}><div style={{fontSize:"22px",fontWeight:700,color:streak>0?"#D97706":T.muted}}>{streak>0?`🔥${streak}`:"-"}</div><div style={{fontSize:"11px",color:T.muted}}>Current streak</div></div>
            <div style={{textAlign:"center"}}><div style={{fontSize:"22px",fontWeight:700,color:T.ink}}>{bestStreak}</div><div style={{fontSize:"11px",color:T.muted}}>Best streak</div></div>
            <div style={{textAlign:"center"}}><div style={{fontSize:"22px",fontWeight:700,color:T.ink}}>{totalTasksDone}</div><div style={{fontSize:"11px",color:T.muted}}>Tasks done ever</div></div>
            <div style={{textAlign:"center"}}><div style={{fontSize:"22px",fontWeight:700,color:T.ink}}>{totalNotes}</div><div style={{fontSize:"11px",color:T.muted}}>Notes added</div></div>
          </div>
        </div>

        {/* This week breakdown */}
        <Card accent={scoreColor(s)} style={{marginBottom:10}}>
          <h3 style={{margin:"0 0 12px",fontSize:"13px",fontWeight:700,color:T.ink}}>This week</h3>
          <div style={{background:T.border,borderRadius:2,height:6,marginBottom:14,overflow:"hidden"}}>
            <div style={{background:scoreColor(s),height:"100%",width:`${s}%`,borderRadius:2}}/>
          </div>
          {[
            {label:"Win Today days", pts:b.winPts||0, max:30, detail:`${b.winDays||0}/3 days`},
            {label:"Tasks completed", pts:b.taskPts||0, max:40, detail:`${b.doneTW||0} done`},
            {label:"Commitments closed", pts:b.commitPts||0, max:20, detail:`${b.closedTW||0} closed`},
            {label:"Meeting notes", pts:b.notesPts||0, max:10, detail:`${b.notesTW||0} added`},
          ].map(row=>(
            <div key={row.label} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{fontSize:"12px",color:T.mid,width:140,flexShrink:0}}>{row.label}</span>
              <div style={{flex:1,background:T.border,borderRadius:2,height:4,overflow:"hidden"}}>
                <div style={{background:row.pts>0?scoreColor(s):T.border,height:"100%",width:`${(row.pts/row.max)*100}%`,borderRadius:2}}/>
              </div>
              <span style={{fontSize:"11px",color:T.muted,width:60,textAlign:"right",flexShrink:0}}>{row.detail}</span>
              <span style={{fontSize:"11px",fontWeight:700,color:row.pts>0?scoreColor(s):T.muted,width:32,textAlign:"right",flexShrink:0}}>{row.pts}pt</span>
            </div>
          ))}
        </Card>

        {/* Trend — last 12 weeks */}
        {scores.length>1&&(
          <Card>
            <h3 style={{margin:"0 0 14px",fontSize:"13px",fontWeight:700,color:T.ink}}>Trend — last {scores.length} weeks</h3>
            <div style={{display:"flex",gap:4,alignItems:"flex-end",height:60}}>
              {[...scores].reverse().map((sc,i)=>{
                const isCurrentWeek = i===scores.length-1;
                return(
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                    <div style={{width:"100%",background:isCurrentWeek?scoreColor(sc.score):scoreColor(sc.score)+"80",borderRadius:"2px 2px 0 0",height:`${Math.max(4,Math.round((sc.score/100)*56))}px`}}/>
                    <span style={{fontSize:"9px",color:isCurrentWeek?T.ink:T.muted,fontWeight:isCurrentWeek?700:400}}>{sc.score}</span>
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
              <span style={{fontSize:"10px",color:T.muted}}>{scores.length} weeks ago</span>
              <span style={{fontSize:"10px",color:T.ink,fontWeight:600}}>This week</span>
            </div>
          </Card>
        )}

        {/* Plain English insights */}
        <Card style={{marginTop:4}}>
          <h3 style={{margin:"0 0 10px",fontSize:"13px",fontWeight:700,color:T.ink}}>Insights</h3>
          {[
            b.winDays===3 && "You completed all 3 Win Today tasks every day this week. That's a perfect week.",
            b.winDays===0 && scores.length>1 && "You haven't started Win Today this week. Pick your 3 on the Home screen.",
            b.doneTW>0 && `You completed ${b.doneTW} task${b.doneTW!==1?"s":""} this week.`,
            delta!==null && delta>0 && `Your score is up ${delta} points from last week. Momentum building.`,
            delta!==null && delta<0 && `Your score dropped ${Math.abs(delta)} points from last week. Win Today can help recover it.`,
            streak>3 && `You're on a ${streak}-day Win Today streak. Don't break it.`,
            bestStreak>0 && streak===0 && `Your best streak was ${bestStreak} days. Start again today.`,
            scores.length>=4 && (()=>{ const avg=Math.round(scores.slice(0,4).reduce((a,s)=>a+s.score,0)/Math.min(scores.length,4)); return `Your 4-week average is ${avg} pts (${scoreLabel(avg).toLowerCase()}).`; })(),
          ].filter(Boolean).map((insight,i)=>(
            <p key={i} style={{margin:"0 0 8px",fontSize:"13px",color:T.mid,lineHeight:1.5,textAlign:"left"}}>— {insight}</p>
          ))}
        </Card>
      </>}
    </Shell>
  );
};

// ─── Win Today component ──────────────────────────────────────────────────────
const WinToday = ({userId, todos, projects}) => {
  const [focus, setFocus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);

  const computeStreak = (days) => {
    // days: [{focus_date, tasks}] sorted desc
    let cur=0, best=0, prev=null;
    for(const d of [...days].sort((a,b)=>b.focus_date.localeCompare(a.focus_date))) {
      let allDone=false;
      try{ const t=JSON.parse(d.tasks); allDone=t.length>0&&t.every(x=>x.done); }catch{}
      if(allDone){
        if(prev===null){
          // Only count if today or yesterday
          const today=new Date().toISOString().slice(0,10);
          const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
          if(d.focus_date===today||d.focus_date===yesterday) cur=1;
          else cur=0;
        } else {
          const expected=new Date(prev); expected.setDate(expected.getDate()-1);
          if(d.focus_date===expected.toISOString().slice(0,10)) cur++;
          else cur=0;
        }
        if(cur>best) best=cur;
        prev=d.focus_date;
      } else {
        if(cur>best) best=cur;
        cur=0; prev=d.focus_date;
      }
    }
    if(cur>best) best=cur;
    return {cur, best};
  };

  useEffect(()=>{
    if(!userId) return;
    const load = async () => {
      const [focusToday, focusHistory] = await Promise.all([
        db.getDailyFocus(userId),
        db.getDailyFocusRange(userId, 60),
      ]);
      if(focusToday?.tasks){ try{ setFocus(JSON.parse(focusToday.tasks)); }catch{} }
      const {cur,best} = computeStreak(focusHistory);
      setStreak(cur); setBestStreak(best);
      setLoading(false);
    };
    load();
  },[userId]);

  const generate = async () => {
    setGenerating(true);
    try {
      const open = todos.filter(t=>!t.done);
      if(open.length===0){ setFocus([]); setGenerating(false); return; }
      const taskList = open.map(t=>{
        const p = projects.find(pp=>pp.id===t.projectId);
        const daysToDeadline = t.dueDate ? Math.floor((new Date(t.dueDate)-Date.now())/(1000*60*60*24)) : null;
        return `ID:${t.id} | "${t.text}" | project:${p?.name||"none"} | due:${daysToDeadline!==null?daysToDeadline+"d":"no date"} | source:${t.source}`;
      }).join("\n");
      const raw = await claude(`You are a productivity coach. Pick exactly 3 tasks for the user to complete TODAY. Prioritise: 1) overdue, 2) due soon, 3) quick/easy wins (short text = easy), 4) AI-extracted commitments. For each pick give a short reason (max 6 words, lowercase). Return ONLY valid JSON, no other text:\n[{"id":"taskid","reason":"overdue by 2 days"},{"id":"taskid","reason":"quick win, 5 mins"},{"id":"taskid","reason":"due tomorrow"}]\n\nOpen tasks:\n${taskList}`, 200);
      const picks = parseJsonSafe(raw);
      if(!Array.isArray(picks)||picks.length===0) throw new Error("bad response");
      const picked = picks.slice(0,3).map(pick=>{
        const t = open.find(tt=>tt.id===pick.id);
        return t ? {todoId:t.id, text:t.text, projectId:t.projectId, done:false, reason:pick.reason||""} : null;
      }).filter(Boolean);
      if(picked.length===0) throw new Error("no valid tasks");
      setFocus(picked);
      await db.saveDailyFocus(userId, picked);
    } catch { setFocus([]); }
    finally { setGenerating(false); }
  };

  const toggle = async (todoId) => {
    const updated = focus.map(f=>f.todoId===todoId?{...f,done:!f.done}:f);
    setFocus(updated);
    await db.saveDailyFocus(userId, updated);
  };

  const reset = async () => { setFocus(null); await generate(); };

  if(loading) return null;

  const allDone = focus&&focus.length>0&&focus.every(f=>f.done);
  const doneCount = focus ? focus.filter(f=>f.done).length : 0;

  return (
    <div style={{background:allDone?"#FFFBEB":T.white,border:`1px solid ${allDone?"#F59E0B":T.border}`,borderLeft:`3px solid ${allDone?"#F59E0B":T.accent}`,padding:"14px 18px",marginBottom:10,fontFamily:T.sans}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:collapsed?0:8}}>
        <div style={{cursor:"pointer",flex:1}} onClick={()=>setCollapsed(c=>!c)}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <h2 style={{margin:0,fontFamily:T.serif,fontSize:"15px",fontWeight:700,color:T.ink}}>Win Today</h2>
            {focus&&focus.length>0&&<span style={{fontSize:"11px",color:allDone?"#D97706":T.muted,fontWeight:600}}>{doneCount}/3</span>}
            {streak>0&&<span style={{fontSize:"12px",fontWeight:700,color:"#D97706"}}>🔥{streak}</span>}
            <span style={{fontSize:"10px",color:T.muted}}>{collapsed?"▼":"▲"}</span>
          </div>
          {!collapsed&&<p style={{margin:"3px 0 0",fontSize:"12px",color:T.muted,textAlign:"left"}}>Your 3 best bets for today — picked by Debrief. Clear all 3 and unlock your daily score.{bestStreak>1&&<span style={{color:T.muted}}> Best streak: {bestStreak} days.</span>}</p>}
        </div>
        <div style={{display:"flex",gap:6,flexShrink:0,marginLeft:12}}>
          {focus!==null&&<button onClick={reset} disabled={generating} style={{background:"none",border:"none",cursor:"pointer",fontSize:"11px",color:T.muted,fontFamily:T.sans,padding:0}}>{generating?"…":"↻ Repick"}</button>}
          {focus===null&&<Btn size="sm" onClick={generate} disabled={generating}>{generating?"Picking…":"Pick my 3"}</Btn>}
        </div>
      </div>

      {!collapsed&&(<>
        {/* All done celebration */}
        {allDone&&(
          <div style={{background:"#FEF3C7",border:"1px solid #F59E0B",borderRadius:4,padding:"10px 14px",marginBottom:10,textAlign:"left"}}>
            <p style={{margin:0,fontSize:"13px",fontWeight:700,color:"#92400E"}}>All 3 done. Check your score below.</p>
          </div>
        )}
        {focus===null&&!generating&&<p style={{margin:0,fontSize:"13px",color:T.muted,textAlign:"left"}}>Debrief will look at your open tasks and pick the 3 smartest things to do today.</p>}
        {generating&&<p style={{margin:0,fontSize:"13px",color:T.muted,textAlign:"left"}}>Picking your best 3 for today…</p>}
        {focus&&focus.length===0&&<p style={{margin:0,fontSize:"13px",color:T.muted,textAlign:"left"}}>No open tasks — you're already ahead!</p>}
        {focus&&focus.map((f)=>{
          const proj = projects.find(p=>p.id===f.projectId);
          // Keep in sync with todos — check live done status
          const liveTodo = todos.find(t=>t.id===f.todoId);
          const isDone = f.done || (liveTodo&&liveTodo.done);
          return (
            <div key={f.todoId} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 0",borderBottom:`1px solid ${T.border}`}}>
              <input type="checkbox" checked={isDone} onChange={()=>toggle(f.todoId)} style={{marginTop:3,accentColor:T.accent,cursor:"pointer",flexShrink:0}}/>
              <div style={{flex:1,minWidth:0,textAlign:"left"}}>
                <span style={{fontSize:"13px",color:isDone?T.muted:T.ink,textDecoration:isDone?"line-through":"none",lineHeight:1.4,display:"block"}}>{f.text}</span>
                <div style={{display:"flex",gap:6,marginTop:2,flexWrap:"wrap",alignItems:"center"}}>
                  {f.reason&&<span style={{fontSize:"11px",color:T.muted}}>({f.reason})</span>}
                  {proj&&<span style={{fontSize:"10px",color:T.accentMid,fontWeight:600,textTransform:"uppercase"}}>{proj.name}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </>)}
    </div>
  );
};

// ─── ThisWeekList — proper component so useState is legal ────────────────────
const ThisWeekList = ({todos,projects,members,onToggle,onDelete,onEdit,onProjectNav,onReassign}) => {
  const [showAll,setShowAll] = useState(false);
  const visible = showAll ? todos : todos.slice(0,5);
  return (<>
    {visible.map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} onProjectNav={onProjectNav} onReassignProject={onReassign}/>)}
    {todos.length>5&&<button onClick={()=>setShowAll(s=>!s)} style={{marginTop:8,fontSize:"12px",color:T.accentMid,background:"none",border:"none",cursor:"pointer",fontFamily:T.sans,padding:0}}>{showAll?`Show less ↑`:`Show all ${todos.length} tasks ↓`}</button>}
  </>);
};

// ─── MemberCard — proper component so useState is legal ──────────────────────
const MemberCard = ({m,nc,openComm,onView,onShare,onEdit,onDelete}) => {
  const [editing,setEditing] = useState(false);
  const [eName,setEName] = useState(m.name);
  const [eRole,setERole] = useState(m.role||"");
  return (
    <Card accent={avatarBg(m.name)} style={{marginBottom:0}}>
      {editing?(
        <div>
          <input value={eName} onChange={e=>setEName(e.target.value)} style={{...inp,marginBottom:6,fontSize:"13px",padding:"5px 8px"}}/>
          <input value={eRole} onChange={e=>setERole(e.target.value)} placeholder="Role" style={{...inp,marginBottom:8,fontSize:"13px",padding:"5px 8px"}}/>
          <div style={{display:"flex",gap:6}}>
            <Btn size="sm" onClick={()=>{onEdit(m.id,eName,eRole);setEditing(false);}}>Save</Btn>
            <Btn size="sm" variant="secondary" onClick={()=>setEditing(false)}>Cancel</Btn>
          </div>
        </div>
      ):(
        <>
          <div onClick={onView} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,cursor:"pointer"}}>
            <Av name={m.name} size={30}/>
            <div style={{minWidth:0,flex:1}}><div style={{fontWeight:600,fontSize:"13px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:T.ink}}>{m.name}</div>{m.role&&<div style={{fontSize:"11px",color:T.muted}}>{m.role}</div>}</div>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:"11px",color:T.muted}}>
            <div style={{display:"flex",gap:8}}><span>{nc} notes</span>{openComm>0&&<span style={{color:T.warning}}>⚡ {openComm} open</span>}</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <button onClick={e=>{e.stopPropagation();onShare();}} title="Copy share link" style={{background:"none",border:"none",cursor:"pointer",fontSize:"12px",color:T.accentMid,padding:0,fontFamily:T.sans}}>🔗</button>
              <button onClick={e=>{e.stopPropagation();setEName(m.name);setERole(m.role||"");setEditing(true);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:"12px",color:T.muted,padding:0}} title="Edit">✎</button>
              <button onClick={e=>{e.stopPropagation();onDelete(m.id);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:"13px",color:T.muted,padding:0}} title="Remove">✕</button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
};

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const shareToken = useMemo(()=>{ const p=new URLSearchParams(window.location.search); return p.get("share")||null; },[]);
  if(shareToken) return <SharedTaskView token={shareToken}/>;

  const [userId,setUserId]=useState(null);
  const [data,setData]=useState(null);
  const [showTour,setShowTour]=useState(false);
  const [showSearch,setShowSearch]=useState(false);
  const [editingNote,setEditingNote]=useState(null);
  const [editSaving,setEditSaving]=useState(false);
  const [view,setView]=useState("home");
  const [navScore,setNavScore]=useState(null); // {score, color} — shown in nav bar
  const [activeIdx,setActiveIdx]=useState(null);
  const [activeMemberId,setActiveMemberId]=useState(null);
  const [loading,setLoading]=useState(false);
  const [homeLoading,setHomeLoading]=useState(false);
  const [memberLoading,setMemberLoading]=useState(false);
  const [riskLoading,setRiskLoading]=useState(false);
  const [error,setError]=useState("");
  const [expandedNote,setExpandedNote]=useState(null);
  const [newProjName,setNewProjName]=useState("");
  // FIX #7: new project context field
  const [newProjContext,setNewProjContext]=useState("");
  const [newProjDeadline,setNewProjDeadline]=useState("");
  // FIX #7: edit context on project page
  const [editingContext,setEditingContext]=useState(false);
  const [contextDraft,setContextDraft]=useState("");
  const [editingDeadline,setEditingDeadline]=useState(false);
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
  const [newTodoProjectId,setNewTodoProjectId]=useState("__none__");
  const [newTodoMemberId,setNewTodoMemberId]=useState("");
  const [todoFilter,setTodoFilter]=useState("pending");
  const [todoProjectFilter,setTodoProjectFilter]=useState("__all__");
  const [todoDueFilter,setTodoDueFilter]=useState("all");
  const [todoMemberFilter,setTodoMemberFilter]=useState("__all__"); // __all__ or member id
  const [activeProjectTab,setActiveProjectTab]=useState("notes");
  const [toast,setToast]=useState(null);
  const [ragPickerProjectId,setRagPickerProjectId]=useState(null);
  const [showBriefing,setShowBriefing]=useState(false);
  // FIX #3: project reassign picker
  const [reassignTodo,setReassignTodo]=useState(null); // {id, currentProjectId}
  // FIX #5: show all toggles
  const [showAllRisks,setShowAllRisks]=useState(false);
  const [showAllProjects,setShowAllProjects]=useState(false);
  const [goals,setGoals]=useState([]);
  const [goalLinks,setGoalLinks]=useState([]);
  const [contextSuggestion,setContextSuggestion]=useState(null);
  const [crossRisks,setCrossRisks]=useState([]);
  const [newGoalTitle,setNewGoalTitle]=useState("");
  const [newGoalDesc,setNewGoalDesc]=useState("");
  const [newGoalDate,setNewGoalDate]=useState("");
  const [editingGoalId,setEditingGoalId]=useState(null);
  const [decFilter,setDecFilter]=useState("__all__");
  const [decSearch,setDecSearch]=useState("");
  const [nudgeOpen,setNudgeOpen]=useState(false);
  const [pricingIndia,setPricingIndia]=useState(false);
  const [annual,setAnnual]=useState(true);
  useEffect(()=>{ fetch("https://ipapi.co/json/").then(r=>r.json()).then(d=>{ if(d.country_code==="IN") setPricingIndia(true); }).catch(()=>{}); },[]);

  const taggedMembersRef=useRef([]);
  const taggedSelfRef=useRef(false);

  useEffect(()=>{
    db.getUser().then(user=>{ if(user){ setUserId(user.id); db.loadAll(user.id).then(d=>{ setData(d); if(d.me)setMeName(d.me); if(d.me&&!d.tourDone)setShowTour(true); }); db.loadGoals(user.id).then(({goals,links})=>{setGoals(goals);setGoalLinks(links);}); } });
  },[]);
  useEffect(()=>{
    const h=e=>{ if(e.key==="k"&&(e.metaKey||e.ctrlKey)){e.preventDefault();setShowSearch(s=>!s);} };
    window.addEventListener("keydown",h); return()=>window.removeEventListener("keydown",h);
  },[]);

  const projects=data?.projects||[];
  const members=data?.members||[];
  const todos=data?.todos||[];
  const allRisks=data?.risks||[];
  const activeProject=activeIdx!==null?projects[activeIdx]:null;
  const activeMember=activeMemberId?members.find(m=>m.id===activeMemberId):null;
  const undismissedRisks=allRisks.filter(r=>!r.dismissed);

  const reload=async()=>{ if(!userId)return null; const d=await db.loadAll(userId); setData(d); return d; };

  // Compute nav score badge on mount — fire and forget, doesn't block anything
  useEffect(()=>{
    if(!userId) return;
    (async()=>{
      try{
        const [d, focusDays] = await Promise.all([db.loadAll(userId), db.getDailyFocusRange(userId,14)]);
        const allCommitments=(d.projects||[]).flatMap(p=>p.commitments||[]);
        const allNotes=(d.projects||[]).flatMap(p=>p.notes||[]);
        const allTodos=(d.todos||[]).map(t=>({...t,doneAt:t.done_at}));
        const {total}=calcScore(allTodos,allCommitments,allNotes,focusDays);
        setNavScore({score:total,color:scoreColor(total)});
      }catch{}
    })();
  },[userId]);
  const meInNotes=text=>data?.me&&text.toLowerCase().includes(data.me.toLowerCase());
  const extractMentions=text=>members.filter(m=>text.toLowerCase().includes(m.name.toLowerCase())||text.includes(`@${m.name}`));

  const saveMe=async()=>{ if(!meName.trim()||!userId)return; await db.setName(userId,meName.trim()); setData(d=>({...d,me:meName.trim()})); setShowTour(true); };
  const handleTourDone=async()=>{ setShowTour(false); if(userId)await db.completeTour(userId); };
  const signOut=async()=>{ await supabase.auth.signOut(); window.location.reload(); };

  // FIX #7: project context prepended to all AI calls for that project
  const projCtxPrefix = proj => proj?.context ? `Project background: ${proj.context}\n\n` : "";

  // RAG suggestion (non-override, skips if user override active)
  const suggestRag = async (projectId, proj) => {
    try {
      if(proj.ragOverride) return;
      const openTasks=todos.filter(t=>!t.done&&t.projectId===projectId);
      const overdueTasks=openTasks.filter(t=>isOverdue(t.dueDate));
      const activeRisks=(proj.risks||[]).filter(r=>!r.dismissed);
      const highRisks=activeRisks.filter(r=>r.severity==="high");
      const lastNote=[...(proj.notes||[])].sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
      const daysSince=lastNote?Math.floor((Date.now()-new Date(lastNote.date))/(1000*60*60*24)):999;
      const daysToDeadline=proj.deadline?Math.floor((new Date(proj.deadline)-Date.now())/(1000*60*60*24)):null;
      const raw=await claude(`Suggest a health status: return ONLY one word: "red", "amber", or "green".\nRed = in trouble (high risks, many overdue, stale 30+ days, OR deadline <7 days away with open tasks). Amber = needs attention (some overdue, medium risks, stale 14+ days, OR deadline <21 days with open tasks). Green = on track.\n\nProject: ${proj.name}\nDays since last note: ${daysSince}\nOpen tasks: ${openTasks.length} (${overdueTasks.length} overdue)\nHigh severity risks: ${highRisks.length}\nActive risks: ${activeRisks.length}\n${daysToDeadline!==null?`Days to deadline: ${daysToDeadline}`:"No deadline set"}\nStatus: ${proj.status?proj.status.slice(0,200):"none"}`,10);
      const rag=raw.trim().toLowerCase().replace(/[^a-z]/g,"");
      if(["red","amber","green"].includes(rag)) await db.updateProjectRag(projectId,rag,false);
    } catch {}
  };

  // FIX #6: re-evaluate risks — wipe old, insert only high-impact fresh ones
  const reevaluateRisks = async (projectId, proj, userId) => {
    try {
      const allNotes = (proj.notes||[]).map((n,i)=>`Meeting ${i+1} [${fmt(n.date)}]:\n${n.summary}`).join("\n\n");
      const openCommitments = (proj.commitments||[]).filter(c=>c.status==="open").map(c=>c.commitment_text).join(", ");
      const openTasks = todos.filter(t=>!t.done&&t.projectId===projectId).map(t=>t.text).join(", ");
      const daysToDeadline=proj.deadline?Math.floor((new Date(proj.deadline)-Date.now())/(1000*60*60*24)):null;
      const raw = await claude(`${projCtxPrefix(proj)}Analyse this project and identify ONLY serious, high-impact risks. Do NOT flag minor or routine concerns. Only flag things that could genuinely derail the project, cause major delays, damage relationships, or result in significant failure.

Return ONLY valid JSON array (max 5 items), no other text:
[{"text": "specific risk description", "severity": "high|medium"}]

Only include severity "high" or "medium". Do NOT include "low" risks.
If there are no serious risks, return [].

Project: ${proj.name}
${daysToDeadline!==null?`Deadline: ${fmt(proj.deadline)} (${daysToDeadline} days away)`:"No deadline set"}
${proj.status ? `Current status: ${proj.status.slice(0,400)}` : ""}
Open tasks: ${openTasks||"none"}
Open commitments: ${openCommitments||"none"}

Meeting notes:
${allNotes||"No notes yet."}`, 400);
      const risks = parseJsonSafe(raw);
      if(Array.isArray(risks)) await db.replaceRisks(userId, projectId, risks);
    } catch {}
  };

  const extractIntelligence=async(summary,noteId,projectId,projName,existingNotes,proj)=>{
    try{
      const priorContext=existingNotes.slice(-5).map(n=>n.summary).join("\n\n");
      const raw=await claude(`${projCtxPrefix(proj)}Analyse this meeting summary and extract structured intelligence. Return ONLY valid JSON, no other text.

{
  "decisions": [{"decision": "what was decided", "context": "why or by whom"}],
  "commitments": [{"person": "name or 'unclear'", "commitment": "what they committed to"}],
  "quality": {"score": 1-10, "feedback": "one sentence", "breakdown": {"had_decisions": true/false, "had_action_owners": true/false, "had_clear_outcomes": true/false}},
  "contradictions": ["description of any contradiction with prior context if found, else empty array"]
}

Prior context from earlier meetings:
${priorContext||"None"}

Current meeting summary:
${summary}`,500);
      return parseJsonSafe(raw)||{decisions:[],commitments:[],quality:null,contradictions:[]};
    }catch{return{decisions:[],commitments:[],quality:null,contradictions:[]};}
  };

  const generateHomeSummary=async()=>{
    if(!userId)return; setHomeLoading(true);
    try{
      const d=await db.loadAll(userId);
      const projectContext=d.projects.map(p=>{
        const openTasks=(d.todos||[]).filter(t=>!t.done&&t.projectId===p.id);
        const doneTasks=(d.todos||[]).filter(t=>t.done&&t.projectId===p.id);
        const openCommitments=(p.commitments||[]).filter(c=>c.status==="open");
        const pRisks=(p.risks||[]).filter(r=>!r.dismissed);
        return `### ${p.name}\nStatus: ${p.status||"No status yet"}\nOpen tasks (${openTasks.length}): ${openTasks.length>0?openTasks.map(t=>`- ${t.text}${t.dueDate?` (due ${fmtShort(t.dueDate)})`:""}${isOverdue(t.dueDate)?" OVERDUE":""}`).join("\n"):"none"}\nCompleted: ${doneTasks.length>0?doneTasks.map(t=>`- ${t.text}`).join(", "):"none"}\nOpen commitments: ${openCommitments.length>0?openCommitments.map(c=>`- ${c.commitment_text}`).join("\n"):"none"}\nRisks: ${pRisks.length>0?pRisks.map(r=>`[${r.severity}] ${r.risk_text}`).join("\n"):"none"}`;
      }).join("\n\n");
      const standaloneTasks=(d.todos||[]).filter(t=>!t.projectId);
      const summary=await claude(`You are writing a weekly executive briefing for ${d.me||"the user"}. Be specific and direct. No filler.\n\nALL PROJECTS:\n${projectContext||"No projects yet."}\n\nSTANDALONE TASKS:\n${standaloneTasks.length>0?standaloneTasks.map(t=>`- [${t.done?"DONE":"PENDING"}] ${t.text}`).join("\n"):"none"}\n\nWrite:\n## Projects\nFor each project: one sentence status, bullet open tasks (mark OVERDUE), open commitments, risks. Skip empty projects.\n## Standalone Tasks\nBullet list or "None."\n## Next Week\n3-5 specific prioritised actions.`,1000);
      await db.upsertHomeSummary(userId,summary); await reload();
    }catch(e){console.error(e);}finally{setHomeLoading(false);}
  };

  // FIX #4: addTodo — explicit __none__ sentinel so "No project" actually saves null
  const addTodo=async()=>{
    if(!newTodoText.trim()||!userId)return;
    const assignedProjectId = newTodoProjectId==="__none__" ? null : (newTodoProjectId||null);
    const t=await db.createTodo(userId,{text:newTodoText.trim(),dueDate:newTodoDue||null,projectId:assignedProjectId,source:'manual',memberId:newTodoMemberId||null});
    setData(d=>({...d,todos:[...d.todos,t]}));
    setNewTodoText(""); setNewTodoDue(""); setNewTodoProjectId("__none__"); setNewTodoMemberId("");
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
    const todo=todos.find(t=>t.id===id); if(!todo)return;
    const nowDone=!todo.done;
    await db.toggleTodo(id,nowDone);
    setData(d=>({...d,todos:d.todos.map(t=>t.id===id?{...t,done:nowDone}:t)}));
    if(nowDone&&todo.projectId){
      const pIdx=projects.findIndex(p=>p.id===todo.projectId);
      if(pIdx>=0&&projects[pIdx].notes.length>0){
        try{ const s=await claude(`${projCtxPrefix(projects[pIdx])}Latest status for "${projects[pIdx].name}". Task completed: "${todo.text}".\n${projects[pIdx].notes.map((n,i)=>`Meeting ${i+1}:\n${n.summary}`).join("\n\n")}`,700); await db.updateProjectStatus(todo.projectId,s); await reload(); }catch{}
      }
    }
  };

  const deleteTodo=async id=>{ await db.deleteTodo(id); setData(d=>({...d,todos:d.todos.filter(t=>t.id!==id)})); };
  const editTodo=async(id,text,dueDate)=>{
    await db.updateTodoText(id,text,dueDate);
    setData(d=>({...d,todos:d.todos.map(t=>t.id===id?{...t,text,dueDate}:t)}));
  };

  // FIX #3: reassign todo project
  const handleReassignProject=async(todoId, newProjectId)=>{
    await db.updateTodoProject(todoId, newProjectId);
    setData(d=>({...d,todos:d.todos.map(t=>t.id===todoId?{...t,projectId:newProjectId}:t)}));
    setReassignTodo(null);
  };

  const addMember=async()=>{ if(!newMemberName.trim()||!userId)return; const m=await db.createMember(userId,{name:newMemberName.trim(),role:newMemberRole.trim()}); setData(d=>({...d,members:[...d.members,m]})); setNewMemberName(""); setNewMemberRole(""); };
  const deleteMember=async id=>{ if(!window.confirm("Remove this team member?"))return; await db.deleteMember(id); setData(d=>({...d,members:d.members.filter(m=>m.id!==id)})); };
  const editMember=async(id,name,role)=>{ await db.updateMember(id,{name,role}); setData(d=>({...d,members:d.members.map(m=>m.id===id?{...m,name,role}:m)})); };

  const generateMemberSummary=async memberId=>{
    setMemberLoading(true);
    try{
      const member=members.find(m=>m.id===memberId); if(!member)return;
      const mentions=[];
      for(const p of projects) for(const n of p.notes) if(n.raw.toLowerCase().includes(member.name.toLowerCase())||n.taggedMembers?.includes(member.id)) mentions.push({project:p.name,date:n.date,summary:n.summary});
      const allCommitments=projects.flatMap(p=>(p.commitments||[]).filter(c=>c.member_id===memberId));
      const summary=mentions.length===0?"No notes mention this person yet.":await claude(`Summarise ${member.name}'s activity across all projects.\n\nMeeting appearances:\n${mentions.map(m=>`[${m.project}] ${fmt(m.date)}:\n${m.summary}`).join("\n\n---\n\n")}\n\nCommitments (${allCommitments.length}):\n${allCommitments.map(c=>`- [${c.status}] ${c.commitment_text}`).join("\n")||"none"}`,900);
      const intelligence=mentions.length>0?await claude(`Build a stakeholder intelligence profile for ${member.name}. Cover: what they care about most, how they communicate, what they push back on, reliability on commitments, how to work with them effectively.\n\n${mentions.map(m=>`[${m.project}] ${fmt(m.date)}:\n${m.summary}`).join("\n\n")}`,500):"";
      await db.updateMemberSummary(memberId,summary);
      if(intelligence) await db.updateMemberIntelligence(memberId,intelligence);
      await reload();
    }catch{}finally{setMemberLoading(false);}
  };

  // FIX #7: createProject now passes context
  const createProject=async()=>{
    if(!newProjName.trim()||!userId)return;
    const p=await db.createProject(userId,newProjName.trim(),newProjContext.trim(),newProjDeadline||null);
    setData(d=>({...d,projects:[...d.projects,p]}));
    setActiveIdx(data.projects.length); setNewProjName(""); setNewProjContext(""); setNewProjDeadline(""); setView("project");
  };

  // FIX #7: save edited context
  const saveContext=async()=>{
    if(!activeProject||!userId)return;
    await db.updateProjectContext(activeProject.id,contextDraft);
    setData(d=>({...d,projects:d.projects.map(p=>p.id===activeProject.id?{...p,context:contextDraft}:p)}));
    setEditingContext(false);
    setToast("Project context saved");
  };

  const buildPriorCtx=proj=>{
    if(!proj||proj.notes.length===0)return"";
    const parts=[];
    if(proj.context)parts.push(`Project background: ${proj.context}`);
    if(proj.status)parts.push(`Status:\n${proj.status}`);
    proj.notes.slice(-3).forEach(n=>parts.push(`[${fmt(n.date)}]\n${n.summary}`));
    return parts.join("\n\n");
  };

  const analyseNote=async notesVal=>{
    if(!notesVal.trim()){setError("Please enter notes.");return;}
    setNotes(notesVal); setError(""); setLoading(true);
    const mentioned=extractMentions(notesVal), selfTagged=meInNotes(notesVal);
    taggedMembersRef.current=mentioned; taggedSelfRef.current=selfTagged;
    setTaggedMembers(mentioned); setTaggedSelf(selfTagged);
    try{
      const prior=buildPriorCtx(activeProject);
      const raw=await claude(`${projCtxPrefix(activeProject)}Review new meeting notes.${prior?` Existing context:\n${prior}\n\n`:" "}Identify up to 3 things STILL unclear that aren't answered by the project background. Return [] if clear. ONLY a valid JSON array of strings.\n\nNotes:\n${notesVal}`,400);
      const qs=parseJsonSafe(raw);
      if(!qs||!Array.isArray(qs)||qs.length===0){await finaliseNote(notesVal,{},mentioned,selfTagged);}
      else{setQuestions(qs);setAnswers(Object.fromEntries(qs.map((_,i)=>[i,""])));setNotePhase("clarifying");}
    }catch{await finaliseNote(notesVal,{},mentioned,selfTagged);}
    finally{setLoading(false);}
  };

  const finaliseNote=async(notesVal,ans,mentionedOvr,selfOvr)=>{
    setLoading(true); setError("");
    const n=notesVal||notes;
    const mentioned=mentionedOvr??taggedMembersRef.current;
    const selfMentioned=selfOvr??taggedSelfRef.current;
    const projSnap=activeProject; // capture before async
    try{
      const clarifs=questions.length>0?"\n\nClarifications:\n"+questions.map((q,i)=>ans[i]?`Q: ${q}\nA: ${ans[i]}`:null).filter(Boolean).join("\n"):"";
      const summary=await claude(`${projCtxPrefix(projSnap)}Convert to structured summary:\n1. Overview\n2. Key decisions\n3. Action items\n4. Discussion\n5. Next steps\nUse markdown.\n\nNotes:\n${n}${clarifs}`,1200);
      const note=await db.createNote(userId,projSnap.id,{raw:n,summary,selfTagged:selfMentioned,taggedMemberIds:mentioned.map(m=>m.id)});

      // ── Navigate immediately — user can see the note now ──────────────────
      setNotes(""); setQuestions([]); setAnswers({}); setTaggedMembers([]); setTaggedSelf(false);
      taggedMembersRef.current=[]; taggedSelfRef.current=false;
      setNotePhase("input"); setLoading(false); setView("project");
      await reload(); // refresh so note appears

      // ── All remaining AI runs silently in background ──────────────────────
      const bgRun = async () => {
        try {
          // Intelligence extraction + saves in parallel
          const [intel] = await Promise.all([
            extractIntelligence(summary,note.id,projSnap.id,projSnap.name,projSnap.notes,projSnap),
          ]);
          await Promise.all([
            intel.decisions?.length>0?db.saveDecisions(userId,projSnap.id,note.id,intel.decisions):Promise.resolve(),
            intel.commitments?.length>0?db.saveCommitments(userId,projSnap.id,note.id,intel.commitments,members):Promise.resolve(),
            intel.quality?db.saveQualityScore(userId,note.id,intel.quality):Promise.resolve(),
            selfMentioned?extractTodosFromNote(summary,projSnap.id):Promise.resolve(),
          ]);
          const d=await reload();
          const proj=d.projects.find(p=>p.id===projSnap.id);
          if(proj){
            // Status + risks + RAG all fire in parallel
            const allS=proj.notes.map((nn,i)=>`Meeting ${i+1} (${fmt(nn.date)}):\n${nn.summary}`).join("\n\n");
            await Promise.all([
              claude(`${projCtxPrefix(proj)}Latest status for "${proj.name}". Current state, open actions, decisions, blockers, next steps.\n${allS}`,700)
                .then(status=>db.updateProjectStatus(proj.id,status)).catch(()=>{}),
              reevaluateRisks(proj.id,{...proj,notes:proj.notes},userId),
              suggestRag(proj.id,proj),
            ]);
            // Member summaries — lowest priority, run last
            for(const m of mentioned){
              const allM=[];
              for(const p of(d.projects||[])) for(const nn of p.notes) if(nn.raw.toLowerCase().includes(m.name.toLowerCase())||nn.taggedMembers?.includes(m.id)) allM.push({project:p.name,date:nn.date,summary:nn.summary});
              if(allM.length>0){try{const ms=await claude(`Summarise ${m.name}'s activity.\n\n${allM.map(a=>`[${a.project}] ${fmt(a.date)}:\n${a.summary}`).join("\n\n---\n\n")}`,700);await db.updateMemberSummary(m.id,ms);}catch{}}
            }
            await reload();
          }
        } catch(e){ console.error("Background processing error:",e); }
      };
      bgRun(); // fire and forget — does NOT block navigation

      // Cross-project risk correlation (runs after note save)
      const runCrossRisk = async () => {
        try {
          const d = await db.loadAll(userId);
          const allRisks = d.projects.flatMap(p=>(p.risks||[]).filter(r=>!r.dismissed).map(r=>({...r,projName:p.name,projId:p.id})));
          if(allRisks.length<2) return;
          const riskList = allRisks.map(r=>`[${r.projName}] ${r.risk_text}`).join("\n");
          const raw = await claude(`Identify risks that appear across multiple projects. Return ONLY valid JSON array of correlations (max 3), no other text:\n[{"theme":"short theme name","projects":["proj1","proj2"],"summary":"one sentence insight"}]\nIf no correlations, return [].\n\nRisks:\n${riskList}`,200);
          const corrs = parseJsonSafe(raw);
          if(Array.isArray(corrs)&&corrs.length>0) setCrossRisks(corrs);
        } catch {}
      };
      runCrossRisk();

      // Context auto-update suggestion
      const suggestContextUpdate = async () => {
        try {
          if(!projSnap.notes||projSnap.notes.length===0) return;
          const currentCtx = projSnap.context||"";
          const raw = await claude(`Based on this new meeting note, suggest a one-sentence update to the project context if something significant changed (timeline, scope, budget, team, decisions). If nothing changed, return empty string.\n\nCurrent context: ${currentCtx}\n\nNew meeting summary: ${summary}`,100);
          const suggestion = raw.trim().replace(/^["']|["']$/g,"");
          if(suggestion&&suggestion.length>10&&suggestion!=="") setContextSuggestion({projectId:projSnap.id,suggestion});
        } catch {}
      };
      suggestContextUpdate();
    }catch(e){setError("Failed to save. Please try again.");console.error(e);setLoading(false);}
  };

  const deleteNote=async noteId=>{
    await db.deleteNote(noteId);
    const d=await reload();
    const proj=d.projects.find(p=>p.id===activeProject?.id);
    if(proj&&proj.notes.length>0){try{const status=await claude(`${projCtxPrefix(proj)}Latest status for "${proj.name}":\n${proj.notes.map((n,i)=>`Meeting ${i+1}:\n${n.summary}`).join("\n\n")}`,700);await db.updateProjectStatus(proj.id,status);await reload();}catch{}}
  };

  const saveEditedNote=async(noteId,newRaw)=>{
    if(!newRaw.trim())return; setEditSaving(true);
    const projSnap=activeProject;
    try{
      const summary=await claude(`${projCtxPrefix(projSnap)}Convert to structured summary:\n1. Overview\n2. Key decisions\n3. Action items\n4. Discussion\n5. Next steps\nUse markdown.\n\nNotes:\n${newRaw}`,1200);
      await db.updateNote(noteId,{raw:newRaw,summary});
      setEditingNote(null); setEditSaving(false);
      await reload();
      // Status update in background
      (async()=>{
        try{
          const d=await db.loadAll(userId);
          const proj=d.projects.find(p=>p.id===projSnap?.id);
          if(proj){const allS=proj.notes.map((n,i)=>`Meeting ${i+1} (${fmt(n.date)}):\n${n.summary}`).join("\n\n");const status=await claude(`${projCtxPrefix(proj)}Latest status for "${proj.name}".\n${allS}`,700);await db.updateProjectStatus(proj.id,status);await reload();}
        }catch{}
      })();
    }catch(e){console.error(e);setEditSaving(false);}
  };

  const shareNote=async(note,projectName)=>{
    const text=`${projectName} — ${fmt(note.date)}\n\n${note.summary.replace(/[#*]/g,"").trim()}`;
    if(navigator.share){try{await navigator.share({title:`Debrief — ${projectName}`,text});return;}catch{}}
    try{ await navigator.clipboard.writeText(text); setToast("Summary copied to clipboard"); }
    catch{ setToast("Copy failed — please copy manually"); }
  };

  const deleteProject=async idx=>{
    const name=projects[idx]?.name||"this project";
    if(!window.confirm(`Delete "${name}"? This will permanently remove all notes, decisions, commitments and risks. This cannot be undone.`))return;
    await db.deleteProject(projects[idx].id); await reload(); setView("home"); setActiveIdx(null);
  };

  const generateShareLink=async memberId=>{
    if(!userId)return;
    const token=await db.createShareToken(userId,memberId);
    const url=`${window.location.origin}${window.location.pathname}?share=${token}`;
    try{ await navigator.clipboard.writeText(url); setToast("Share link copied to clipboard"); }
    catch{ setToast("Share link: "+url); }
  };

  const pendingTodos=todos.filter(t=>!t.done);
  const doneTodos=todos.filter(t=>t.done);
  const overdueTodos=pendingTodos.filter(t=>isOverdue(t.dueDate));
  const thisWeekTodos=pendingTodos.filter(t=>isThisWeek(t.dueDate)||(!t.dueDate&&isThisWeek(t.createdAt)));
  const upcomingTodos=pendingTodos.filter(t=>!isThisWeek(t.dueDate)&&!isOverdue(t.dueDate)&&t.dueDate);
  const undatedTodos=pendingTodos.filter(t=>!t.dueDate&&!isThisWeek(t.createdAt));

  // ─── Nav (FIX #1: added Projects tab) ────────────────────────────────────────
  const Nav=()=>(
    <div style={{marginBottom:24,paddingBottom:14,borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
      <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0,flex:"1 1 auto",overflowX:"auto"}}>
        <Logo onClick={()=>setView("home")}/>
        <div id="tour-nav" style={{display:"flex",gap:0,flexShrink:0}}>
          {/* FIX #1: Projects tab added */}
          {[["home","Home"],["projects","Projects"],["decisions","Decisions"],["goals","Goals"],["todos","My Tasks"],["team","Team"]].map(([v,label])=>(
            <button key={v} onClick={()=>setView(v)} style={{padding:"5px 10px",fontSize:"13px",fontWeight:view===v?700:400,color:view===v?T.accent:T.mid,background:"transparent",border:"none",borderBottom:view===v?`2px solid ${T.accent}`:"2px solid transparent",cursor:"pointer",fontFamily:T.sans,whiteSpace:"nowrap"}}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {data?.me&&<div style={{display:"flex",alignItems:"center",gap:5}}><Av name={data.me} size={22} isSelf/><span style={{fontSize:"12px",color:T.mid}}>{data.me}</span></div>}
        {navScore!==null&&(
          <div onClick={()=>setView("score")} title="Debrief Score — click for details" style={{cursor:"pointer",background:navScore.color+"18",border:`1px solid ${navScore.color}40`,borderRadius:3,padding:"2px 8px",display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:"12px",fontWeight:700,color:navScore.color}}>{navScore.score}</span>
          </div>
        )}
        {undismissedRisks.length>0&&(
          <div onClick={()=>setView("home")} style={{position:"relative",cursor:"pointer"}} title={`${undismissedRisks.length} active risk${undismissedRisks.length>1?"s":""}`}>
            <span style={{fontSize:"13px",color:T.danger}}>⚠</span>
            <span style={{position:"absolute",top:-4,right:-4,background:T.danger,color:"#fff",borderRadius:"50%",width:14,height:14,fontSize:"9px",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{undismissedRisks.length}</span>
          </div>
        )}
        <div id="tour-project">
          <Btn size="sm" onClick={()=>{setNewProjName("");setNewProjContext("");setNewProjDeadline("");setView("newProject");}}>+ Project</Btn>
        </div>
        <Btn size="sm" variant="secondary" onClick={()=>setView("pricing")} style={{fontSize:"11px",padding:"4px 8px"}}>Pricing</Btn>
        <Btn size="sm" variant="secondary" onClick={signOut} style={{fontSize:"11px",padding:"4px 8px"}}>Sign out</Btn>
      </div>
    </div>
  );

  const SectionTitle=({children,sub})=>(<div style={{marginBottom:14}}><h2 style={{margin:0,fontSize:"18px",fontWeight:700,fontFamily:T.serif,color:T.ink,letterSpacing:"-0.01em"}}>{children}</h2>{sub&&<p style={{margin:"2px 0 0",fontSize:"12px",color:T.muted}}>{sub}</p>}</div>);
  const SearchEl=()=>showSearch?<SearchAskOverlay projects={projects} members={members} todos={todos} onClose={()=>setShowSearch(false)} onProjectNav={i=>{setActiveIdx(i);setView("project");}}/>:null;

  if(!data) return <Shell><div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"60vh"}}><p style={{color:T.muted}}>Loading your workspace…</p></div></Shell>;

  if(!data.me) return (
    <Shell maxW={400}>
      <div style={{paddingTop:60,textAlign:"center"}}>
        <div style={{marginBottom:24,display:"flex",justifyContent:"center"}}><Logo/></div>
        <h1 style={{fontFamily:T.serif,fontSize:"26px",fontWeight:700,margin:"0 0 8px",color:T.ink}}>Welcome to Debrief</h1>
        <p style={{color:T.mid,fontSize:"13px",margin:"0 0 32px",lineHeight:1.6}}>What should we call you?</p>
        <Card><Label>Your Name</Label><input value={meName} onChange={e=>setMeName(e.target.value)} placeholder="e.g. John" onKeyDown={e=>e.key==="Enter"&&saveMe()} style={inp}/><div style={{marginTop:12}}><Btn onClick={saveMe} disabled={!meName.trim()}>Get started →</Btn></div></Card>
      </div>
    </Shell>
  );

  // Global pickers rendered at root so they overlay any view
  const GlobalPickers = () => (<>
    {reassignTodo&&<ProjectTagPicker projects={projects} currentProjectId={reassignTodo.currentProjectId} onSelect={newProjId=>handleReassignProject(reassignTodo.id,newProjId)} onClose={()=>setReassignTodo(null)}/>}
    {ragPickerProjectId&&<RagPicker current={projects.find(p=>p.id===ragPickerProjectId)?.rag} onSelect={async rag=>{await db.updateProjectRag(ragPickerProjectId,rag,true);await reload();}} onClose={()=>setRagPickerProjectId(null)}/>}
  </>);

  // ── HOME ──────────────────────────────────────────────────────────────────
  // ── DECISIONS ─────────────────────────────────────────────────────────────
  if(view==="decisions") {
    const allDecisions = projects.flatMap(p=>(p.decisions||[]).map(d=>({...d,projectName:p.name,projIdx:projects.findIndex(pp=>pp.id===p.id)})));
    const filtered = allDecisions.filter(d=>(decFilter==="__all__"||d.project_id===decFilter)&&(decSearch===""||d.decision_text?.toLowerCase().includes(decSearch.toLowerCase())));
    const sorted = [...filtered].sort((a,b)=>new Date(b.date)-new Date(a.date));
    return (
      <Shell>
        <Nav/>
        <SectionTitle sub={`${allDecisions.length} decisions across ${projects.length} projects`}>Decision Log</SectionTitle>
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
          <input value={decSearch} onChange={e=>setDecSearch(e.target.value)} placeholder="Search decisions…" style={{...inp,flex:"1 1 180px",fontSize:"13px"}}/>
          <select value={decFilter} onChange={e=>setDecFilter(e.target.value)} style={{...inp,width:"auto",fontSize:"13px"}}>
            <option value="__all__">All projects</option>
            {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {sorted.length===0?<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No decisions found. Decisions are extracted automatically when you add meeting notes.</p></Card>
        :sorted.map(d=>(
          <Card key={d.id} style={{marginBottom:8,borderLeft:`3px solid ${pc(d.projIdx)}`}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
              <p style={{margin:0,fontSize:"13px",color:T.ink,lineHeight:1.5,flex:1}}>{d.decision_text}</p>
              <span style={{fontSize:"11px",color:T.muted,flexShrink:0,marginTop:2}}>{fmt(d.date)}</span>
            </div>
            <div style={{marginTop:6,display:"flex",gap:6,alignItems:"center"}}>
              <Tag color={pc(d.projIdx)} onClick={()=>{setActiveIdx(d.projIdx);setView("project");}}>{d.projectName}</Tag>
            </div>
          </Card>
        ))}
      </Shell>
    );
  }

  // ── GOALS ─────────────────────────────────────────────────────────────────
  if(view==="goals") {
    const createGoal=async()=>{
      if(!newGoalTitle.trim()||!userId)return;
      const g=await db.createGoal(userId,{title:newGoalTitle.trim(),description:newGoalDesc.trim(),targetDate:newGoalDate||null,owner:data.me||""});
      setGoals(gs=>[g,...gs]); setNewGoalTitle(""); setNewGoalDesc(""); setNewGoalDate("");
    };
    const deleteGoal=async(id)=>{if(!window.confirm("Delete this goal?"))return;await db.deleteGoal(id);setGoals(gs=>gs.filter(g=>g.id!==id));setGoalLinks(ls=>ls.filter(l=>l.goal_id!==id));};
    const toggleLink=async(goalId,projectId,linked)=>{
      if(linked){await db.unlinkProjectFromGoal(goalId,projectId);setGoalLinks(ls=>ls.filter(l=>!(l.goal_id===goalId&&l.project_id===projectId)));}
      else{await db.linkProjectToGoal(goalId,projectId);setGoalLinks(ls=>[...ls,{goal_id:goalId,project_id:projectId}]);}
    };
    return (
      <Shell>
        <Nav/>
        <SectionTitle sub="Company-level goals. Link projects to see how work rolls up.">Goals</SectionTitle>
        <Card style={{marginBottom:12}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
            <div style={{flex:"1 1 160px"}}><Label>Goal title</Label><input value={newGoalTitle} onChange={e=>setNewGoalTitle(e.target.value)} placeholder="e.g. Digital Backbone by Q3" onKeyDown={e=>e.key==="Enter"&&createGoal()} style={inp}/></div>
            <div style={{flex:"1 1 120px"}}><Label>Description</Label><input value={newGoalDesc} onChange={e=>setNewGoalDesc(e.target.value)} placeholder="Optional" style={inp}/></div>
            <div style={{flex:"0 0 auto"}}><Label>Target date</Label><input type="date" value={newGoalDate} onChange={e=>setNewGoalDate(e.target.value)} style={{...inp,width:"auto"}}/></div>
            <Btn onClick={createGoal} disabled={!newGoalTitle.trim()}>+ Add goal</Btn>
          </div>
        </Card>
        {goals.length===0?<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No goals yet. Add your first company goal above.</p></Card>
        :goals.map(g=>{
          const linked=goalLinks.filter(l=>l.goal_id===g.id);
          const linkedProjects=linked.map(l=>projects.find(p=>p.id===l.project_id)).filter(Boolean);
          const greenCount=linkedProjects.filter(p=>p.rag==="green").length;
          const totalLinked=linkedProjects.length;
          const pct=totalLinked>0?Math.round((greenCount/totalLinked)*100):0;
          const daysTo=g.target_date?Math.floor((new Date(g.target_date)-Date.now())/(1000*60*60*24)):null;
          return (
            <Card key={g.id} style={{marginBottom:10,borderLeft:`3px solid ${T.accent}`}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:8,gap:8}}>
                <div style={{flex:1}}>
                  <h3 style={{margin:"0 0 4px",fontFamily:T.serif,fontSize:"16px",fontWeight:700,color:T.ink}}>{g.title}</h3>
                  {g.description&&<p style={{margin:"0 0 4px",fontSize:"12px",color:T.muted}}>{g.description}</p>}
                  {daysTo!==null&&<span style={{fontSize:"11px",color:daysTo<30?T.danger:T.muted}}>📅 {daysTo>0?`${daysTo}d remaining`:"Overdue"}</span>}
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  <button onClick={()=>deleteGoal(g.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:"13px",color:T.muted,padding:0}}>✕</button>
                </div>
              </div>
              {totalLinked>0&&(
                <div style={{marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontSize:"11px",color:T.muted}}>Project health progress</span>
                    <span style={{fontSize:"11px",fontWeight:700,color:pct>=80?"#16A34A":pct>=50?"#F59E0B":"#DC2626"}}>{pct}% on track</span>
                  </div>
                  <div style={{background:T.border,borderRadius:2,height:5,overflow:"hidden"}}>
                    <div style={{background:pct>=80?"#16A34A":pct>=50?"#F59E0B":"#DC2626",height:"100%",width:`${pct}%`,borderRadius:2}}/>
                  </div>
                </div>
              )}
              <div style={{marginBottom:8}}>
                <Label>Linked projects</Label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4}}>
                  {linkedProjects.map(p=>(
                    <span key={p.id} style={{display:"inline-flex",alignItems:"center",gap:4,background:pc(projects.findIndex(pp=>pp.id===p.id))+"20",borderRadius:3,padding:"3px 8px",fontSize:"12px",color:T.ink}}>
                      {p.rag&&<span style={{width:6,height:6,borderRadius:"50%",background:p.rag==="red"?"#DC2626":p.rag==="amber"?"#F59E0B":"#16A34A",display:"inline-block"}}/>}
                      {p.name}
                      <button onClick={()=>toggleLink(g.id,p.id,true)} style={{background:"none",border:"none",cursor:"pointer",fontSize:"11px",color:T.muted,padding:0}}>✕</button>
                    </span>
                  ))}
                </div>
              </div>
              <select onChange={e=>{if(e.target.value)toggleLink(g.id,e.target.value,false);e.target.value="";}} style={{...inp,fontSize:"12px",width:"auto"}} defaultValue="">
                <option value="">+ Link a project…</option>
                {projects.filter(p=>!linked.find(l=>l.project_id===p.id)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Card>
          );
        })}
      </Shell>
    );
  }

  if(view==="score") return <ScorePage userId={userId} todos={todos} data={data} onBack={()=>setView("home")}/>;

  if(view==="pricing") {
    const gumroadIndia = "https://getdebriefs.gumroad.com/l/fpnhta";
    const gumroadIntl  = "https://getdebriefs.gumroad.com/l/duddlw";
    const gumLink = pricingIndia ? gumroadIndia : gumroadIntl;
    const price = annual ? (pricingIndia?"₹2,999":"$99") : (pricingIndia?"₹299":"$9");
    const period = annual ? "/year" : "/month";
    const orig = annual ? (pricingIndia?"₹7,188/year":"$228/year") : (pricingIndia?"₹599/month":"$19/month");
    const saving = annual ? (pricingIndia?"Save 58% — ₹4,189 off":"Save 57% — $129 off") : (pricingIndia?"50% off":"53% off");
    const FEATURES = ["Project-level meeting intelligence","AI summaries, decisions & risk extraction","Commitment tracking across meetings","Pre-meeting briefings","Team reliability scores","Win Today + Debrief Score","Unlimited projects & notes","7-day money-back guarantee"];
    return (
    <Shell maxW={520}>
      <div style={{textAlign:"center",padding:"32px 0 24px"}}>
        <Logo onClick={()=>setView("home")}/>
        <h1 style={{margin:"20px 0 8px",fontFamily:T.serif,fontSize:"26px",fontWeight:700,color:T.ink}}>Simple, honest pricing</h1>
        <p style={{margin:0,fontSize:"14px",color:T.muted}}>Start free. Cancel any time. 7-day money-back guarantee.</p>
      </div>
      <div style={{display:"flex",justifyContent:"center",gap:10,marginBottom:24}}>
        <button onClick={()=>setAnnual(false)} style={{padding:"6px 20px",fontSize:"13px",fontWeight:!annual?700:400,color:!annual?T.white:T.mid,background:!annual?T.accent:"transparent",border:`1px solid ${!annual?T.accent:T.border}`,borderRadius:2,cursor:"pointer",fontFamily:T.sans}}>Monthly</button>
        <button onClick={()=>setAnnual(true)} style={{padding:"6px 20px",fontSize:"13px",fontWeight:annual?700:400,color:annual?T.white:T.mid,background:annual?T.accent:"transparent",border:`1px solid ${annual?T.accent:T.border}`,borderRadius:2,cursor:"pointer",fontFamily:T.sans,display:"flex",alignItems:"center",gap:6}}>
          Annual <span style={{background:"#16A34A",color:"#fff",fontSize:"10px",fontWeight:700,padding:"2px 6px",borderRadius:2}}>Most popular</span>
        </button>
      </div>
      <Card style={{borderTop:`3px solid ${T.accent}`,maxWidth:400,margin:"0 auto 16px"}}>
        <div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:4}}>
          <span style={{fontFamily:T.serif,fontSize:"42px",fontWeight:700,color:T.ink}}>{price}</span>
          <span style={{fontSize:"13px",color:T.muted}}>{period}</span>
        </div>
        <div style={{fontSize:"12px",marginBottom:6}}>
          <span style={{textDecoration:"line-through",color:T.muted}}>{orig}</span>
          <span style={{color:"#16A34A",fontWeight:600,marginLeft:8}}>{saving}</span>
        </div>
        {FEATURES.map(f=>(
          <div key={f} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid ${T.border}`}}>
            <span style={{color:"#16A34A",fontWeight:700,flexShrink:0}}>✓</span>
            <span style={{fontSize:"13px",color:T.mid}}>{f}</span>
          </div>
        ))}
        <div style={{marginTop:20}}>
          <Btn onClick={()=>window.open(gumLink,"_blank")} style={{width:"100%",padding:"12px"}}>Get started →</Btn>
          <p style={{margin:"10px 0 0",fontSize:"12px",color:T.muted,textAlign:"center"}}>via Gumroad · Cards · PayPal · 7-day money-back</p>
        </div>
      </Card>
      <p style={{textAlign:"center",fontSize:"12px",color:T.muted}}>
        <a href="/privacy.html" style={{color:T.muted,marginRight:12}}>Privacy</a>
        <a href="/terms.html" style={{color:T.muted,marginRight:12}}>Terms</a>
        <a href="/refund.html" style={{color:T.muted}}>Refund Policy</a>
      </p>
    </Shell>
    );
  }

  if(view==="home") return (
    <Shell>
      {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
      <GlobalPickers/>
      <SearchEl/>
      {showTour&&<Tour onDone={handleTourDone}/>}
      <BottomSearchBar onClick={()=>setShowSearch(true)}/>
      <Nav/>

      {/* Onboarding checklist — shown until all 3 steps complete */}
      {(()=>{
        const hasProject = projects.length>0;
        const hasNote = projects.some(p=>p.notes.length>0);
        const hasMember = members.length>0;
        const allDone = hasProject&&hasNote&&hasMember;
        if(allDone) return null;
        const steps=[
          {done:hasProject, label:"Create your first project", action:()=>{setNewProjName("");setNewProjContext("");setNewProjDeadline("");setView("newProject");}},
          {done:hasNote, label:"Add meeting notes to a project", action:()=>hasProject?setView("project"):null},
          {done:hasMember, label:"Add a team member", action:()=>setView("team")},
        ];
        const pct = Math.round((steps.filter(s=>s.done).length/3)*100);
        return (
          <Card style={{marginBottom:10,borderLeft:`3px solid ${T.accent}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <h3 style={{margin:0,fontSize:"13px",fontWeight:700,color:T.ink}}>Getting started</h3>
              <span style={{fontSize:"11px",color:T.muted}}>{pct}% complete</span>
            </div>
            <div style={{background:T.border,borderRadius:2,height:4,marginBottom:10,overflow:"hidden"}}>
              <div style={{background:T.accent,height:"100%",width:`${pct}%`,borderRadius:2}}/>
            </div>
            {steps.map((s,i)=>(
              <div key={i} onClick={!s.done?s.action:undefined} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:`1px solid ${T.border}`,cursor:s.done?"default":"pointer"}}>
                <span style={{width:18,height:18,borderRadius:"50%",background:s.done?T.success:T.border,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",fontWeight:700,flexShrink:0}}>{s.done?"✓":i+1}</span>
                <span style={{fontSize:"13px",color:s.done?T.muted:T.ink,textDecoration:s.done?"line-through":"none"}}>{s.label}</span>
                {!s.done&&<span style={{marginLeft:"auto",fontSize:"11px",color:T.accent}}>→</span>}
              </div>
            ))}
          </Card>
        );
      })()}

      {/* #3 Commitment nudges */}
      {(()=>{
        const overdue = projects.flatMap(p=>(p.commitments||[]).filter(c=>c.status==="open"&&c.date&&Math.floor((Date.now()-new Date(c.date))/(1000*60*60*24))>7).map(c=>({...c,projName:p.name,days:Math.floor((Date.now()-new Date(c.date))/(1000*60*60*24))})));
        if(!overdue.length) return null;
        return (
          <div style={{background:"#FEF3C7",border:"1px solid #F59E0B",borderLeft:"3px solid #F59E0B",padding:"10px 16px",marginBottom:10,fontFamily:T.sans}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:"13px",fontWeight:600,color:"#92400E"}}>⚡ {overdue.length} overdue commitment{overdue.length>1?"s":""} need attention</span>
              <button onClick={()=>setNudgeOpen(o=>!o)} style={{background:"none",border:"none",cursor:"pointer",fontSize:"12px",color:"#92400E",fontFamily:T.sans}}>{nudgeOpen?"Hide ▲":"Review ▼"}</button>
            </div>
            {nudgeOpen&&overdue.map(c=>(
              <div key={c.id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:`1px solid #F59E0B30`}}>
                <span style={{fontSize:"12px",color:"#92400E",flex:1}}>{c.commitment_text} <span style={{color:T.muted}}>· {c.projName} · {c.days}d ago</span></span>
                <button onClick={()=>db.updateCommitmentStatus(c.id,"done").then(reload)} style={{background:"none",border:"none",fontSize:"11px",color:"#16A34A",cursor:"pointer",padding:0,fontFamily:T.sans,whiteSpace:"nowrap"}}>Mark done</button>
              </div>
            ))}
          </div>
        );
      })()}

      {/* #4 Gone quiet projects */}
      {(()=>{
        const quiet = projects.filter(p=>{
          if(!p.notes||p.notes.length===0) return false;
          const last = Math.max(...p.notes.map(n=>new Date(n.date)));
          const days = Math.floor((Date.now()-last)/(1000*60*60*24));
          return days >= (p.quietThreshold||7);
        });
        if(!quiet.length) return null;
        return (
          <div style={{background:"#F3F4F6",border:"1px solid #D1D5DB",borderLeft:"3px solid #6B7280",padding:"10px 16px",marginBottom:10,fontFamily:T.sans}}>
            <span style={{fontSize:"13px",fontWeight:600,color:T.ink}}>🔇 {quiet.length} project{quiet.length>1?"s":""} gone quiet</span>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:6}}>
              {quiet.map(p=>{
                const days=Math.floor((Date.now()-Math.max(...p.notes.map(n=>new Date(n.date))))/(1000*60*60*24));
                return <button key={p.id} onClick={()=>{setActiveIdx(projects.findIndex(pp=>pp.id===p.id));setView("project");}} style={{fontSize:"12px",color:T.accent,background:"none",border:`1px solid ${T.border}`,borderRadius:3,padding:"3px 10px",cursor:"pointer",fontFamily:T.sans}}>{p.name} · {days}d</button>;
              })}
            </div>
          </div>
        );
      })()}

      {/* #7 Cross-project risk correlation */}
      {crossRisks.length>0&&(
        <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderLeft:"3px solid #DC2626",padding:"10px 16px",marginBottom:10,fontFamily:T.sans}}>
          <span style={{fontSize:"13px",fontWeight:600,color:"#991B1B"}}>🔗 Cross-project risk pattern detected</span>
          {crossRisks.map((cr,i)=>(
            <div key={i} style={{marginTop:6,fontSize:"12px",color:"#991B1B"}}>
              <strong>{cr.theme}</strong> — {cr.summary} <span style={{color:T.muted}}>({cr.projects?.join(", ")})</span>
            </div>
          ))}
        </div>
      )}

      <WinToday userId={userId} todos={todos} projects={projects}/>

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

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12}}>
        <Card>
          <h3 id="tour-tasks" style={{margin:"0 0 10px",fontSize:"13px",fontWeight:600,color:T.ink}}>This Week <span style={{fontSize:"11px",fontWeight:400,color:T.muted}}>({thisWeekTodos.length+overdueTodos.length})</span></h3>
          {(()=>{
            const allWeek=[...overdueTodos,...thisWeekTodos];
            if(allWeek.length===0) return <p style={{fontSize:"12px",color:T.muted,margin:0}}>No tasks due this week.</p>;
            return <ThisWeekList todos={allWeek} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo} onEdit={editTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}} onReassign={(id,cur)=>setReassignTodo({id,currentProjectId:cur})}/>;
          })()}
        </Card>
        {/* FIX #5: Projects card — show all with scroll */}
        <Card>
          <h3 style={{margin:"0 0 10px",fontSize:"13px",fontWeight:600,color:T.ink}}>Projects <span style={{fontSize:"11px",fontWeight:400,color:T.muted}}>({projects.length})</span></h3>
          {projects.length===0?<p style={{fontSize:"12px",color:T.muted,margin:0}}>No projects yet.</p>
            :<>
              <div>
                {(showAllProjects ? projects : projects.slice(0,6)).map((p,i)=>{
                  const pRisks=(p.risks||[]).filter(r=>!r.dismissed).length;
                  return(
                    <div key={p.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${T.border}`}}>
                      <div onClick={()=>{setActiveIdx(i);setView("project");}} style={{display:"flex",alignItems:"center",gap:7,minWidth:0,flex:1,cursor:"pointer"}}>
                        <div style={{width:3,height:14,background:pc(i),flexShrink:0}}/>
                        <span style={{fontSize:"13px",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:T.ink}}>{p.name}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                        {p.deadline&&(()=>{const d=Math.floor((new Date(p.deadline)-Date.now())/(1000*60*60*24));return <span style={{fontSize:"10px",color:d<0?T.danger:d<=7?T.danger:d<=21?T.warning:T.muted,fontWeight:d<=7?700:400}}>📅{d<0?`${Math.abs(d)}d over`:`${d}d`}</span>})()}
                        {pRisks>0&&<span style={{fontSize:"10px",color:T.danger}}>⚠ {pRisks}</span>}
                        <span style={{fontSize:"11px",color:T.muted}}>{p.notes.length}</span>
                        <div onClick={()=>setRagPickerProjectId(p.id)} title={p.rag?`Health: ${RAG_LABELS[p.rag]} — click to change`:"No health score — click to set"} style={{cursor:"pointer",display:"flex",alignItems:"center"}}>
                          {p.rag?<RagDot rag={p.rag} size={10}/>:<span style={{width:10,height:10,borderRadius:"50%",border:`1.5px dashed ${T.muted}`,display:"inline-block"}}/>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {projects.length>6&&(
                <button onClick={()=>setShowAllProjects(s=>!s)} style={{marginTop:8,fontSize:"12px",color:T.accentMid,background:"none",border:"none",cursor:"pointer",fontFamily:T.sans,padding:0}}>
                  {showAllProjects?"Show less ↑":`Show all ${projects.length} projects ↓`}
                </button>
              )}
            </>}
        </Card>
      </div>

      {/* Risk Radar — bottom of home screen */}
      {undismissedRisks.length>0&&(
        <Card style={{marginTop:12,borderLeft:`3px solid ${T.danger}`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <h2 style={{margin:0,fontFamily:T.serif,fontSize:"15px",fontWeight:700,color:T.danger}}>Risk Radar</h2>
              <span style={{background:T.danger+"14",color:T.danger,borderRadius:2,padding:"1px 7px",fontSize:"11px",fontWeight:700}}>{undismissedRisks.length} active</span>
            </div>
            <Btn variant="ghost" size="sm" onClick={async()=>{
              setRiskLoading(true);
              try{ const d=await db.loadAll(userId); for(const p of d.projects) if(p.notes.length>0) await reevaluateRisks(p.id,p,userId); await reload(); }
              finally{ setRiskLoading(false); }
            }} disabled={riskLoading}>{riskLoading?"Re-evaluating…":"↻ Re-evaluate all"}</Btn>
          </div>
          {(showAllRisks ? undismissedRisks : undismissedRisks.slice(0,4)).map(r=>{
            const proj=projects.find(p=>p.id===r.project_id);
            return(
              <div key={r.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"7px 0",borderBottom:`1px solid ${T.border}`}}>
                <SeverityBadge severity={r.severity}/>
                <div style={{flex:1,minWidth:0,textAlign:"left"}}>
                  <p style={{margin:0,fontSize:"13px",color:T.ink,lineHeight:1.4,textAlign:"left"}}>{r.risk_text}</p>
                  {proj&&<span style={{fontSize:"11px",color:T.muted}}>{proj.name}</span>}
                </div>
                <button onClick={()=>db.dismissRisk(r.id).then(reload)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:12,padding:0,flexShrink:0,whiteSpace:"nowrap"}}>Dismiss</button>
              </div>
            );
          })}
          {undismissedRisks.length>4&&(
            <button onClick={()=>setShowAllRisks(s=>!s)} style={{marginTop:8,fontSize:"12px",color:T.accentMid,background:"none",border:"none",cursor:"pointer",fontFamily:T.sans,padding:0}}>
              {showAllRisks?`Show less ↑`:`Show all ${undismissedRisks.length} risks ↓`}
            </button>
          )}
        </Card>
      )}
    </Shell>
  );

  // ── PROJECTS VIEW (FIX #1) ────────────────────────────────────────────────
  if(view==="projects") return (
    <Shell>
      {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
      <GlobalPickers/>
      <SearchEl/>
      <BottomSearchBar onClick={()=>setShowSearch(true)}/>
      <Nav/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <SectionTitle sub={`${projects.length} project${projects.length!==1?"s":""}`}>Projects</SectionTitle>
        <Btn size="sm" onClick={()=>{setNewProjName("");setNewProjContext("");setNewProjDeadline("");setView("newProject");}}>+ New Project</Btn>
      </div>
      {projects.length===0
        ?<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No projects yet. Create one to get started.</p></Card>
        :<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
          {projects.map((p,i)=>{
            const openTasks=todos.filter(t=>!t.done&&t.projectId===p.id).length;
            const pRisks=(p.risks||[]).filter(r=>!r.dismissed).length;
            const openComm=(p.commitments||[]).filter(c=>c.status==="open").length;
            const lastNote=[...(p.notes||[])].sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
            return(
              <div key={p.id} onClick={()=>{setActiveIdx(i);setView("project");}} style={{background:T.white,border:`1px solid ${T.border}`,borderTop:`3px solid ${pc(i)}`,padding:"14px 16px",cursor:"pointer",fontFamily:T.sans,boxSizing:"border-box"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <h3 style={{margin:0,fontSize:"14px",fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{p.name}</h3>
                  <div onClick={e=>{e.stopPropagation();setRagPickerProjectId(p.id);}} style={{marginLeft:8,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                    {p.rag?<><RagDot rag={p.rag} size={10}/><span style={{fontSize:"11px",color:RAG_COLORS[p.rag],fontWeight:600}}>{RAG_LABELS[p.rag]}</span></>:<span style={{fontSize:"11px",color:T.muted}}>No RAG</span>}
                  </div>
                </div>
                {p.context&&<p style={{margin:"0 0 8px",fontSize:"11px",color:T.mid,lineHeight:1.4,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{p.context}</p>}
                <div style={{display:"flex",gap:10,fontSize:"11px",color:T.muted,flexWrap:"wrap"}}>
                  <span>{p.notes.length} notes</span>
                  {openTasks>0&&<span style={{color:T.accent}}>{openTasks} open tasks</span>}
                  {pRisks>0&&<span style={{color:T.danger}}>⚠ {pRisks} risks</span>}
                  {openComm>0&&<span style={{color:T.warning}}>⚡ {openComm} commitments</span>}
                </div>
                {p.deadline&&(()=>{const d=Math.floor((new Date(p.deadline)-Date.now())/(1000*60*60*24));const c=d<0?T.danger:d<=7?T.danger:d<=21?T.warning:T.muted;return <p style={{margin:"6px 0 0",fontSize:"11px",color:c,fontWeight:d<=7?600:400}}>📅 {fmt(p.deadline)} {d<0?`(${Math.abs(d)}d overdue)`:`(${d}d remaining)`}</p>})()}
                {lastNote&&<p style={{margin:"6px 0 0",fontSize:"11px",color:T.muted}}>Last meeting: {fmt(lastNote.date)}</p>}
              </div>
            );
          })}
        </div>}
    </Shell>
  );

  // ── TODOS ─────────────────────────────────────────────────────────────────
  if(view==="todos") {
    // Apply project + due date filters on top of pending/done
    const baseList = todoFilter==="done" ? doneTodos : pendingTodos;
    const projFiltered = todoProjectFilter==="__all__" ? baseList : baseList.filter(t=>(todoProjectFilter==="__none__" ? !t.projectId : t.projectId===todoProjectFilter));
    const memberFiltered = todoMemberFilter==="__all__" ? projFiltered : projFiltered.filter(t=>t.memberId===todoMemberFilter);
    const dueFiltered = todoDueFilter==="all" ? memberFiltered
      : todoDueFilter==="overdue" ? memberFiltered.filter(t=>isOverdue(t.dueDate))
      : todoDueFilter==="thisweek" ? memberFiltered.filter(t=>isThisWeek(t.dueDate)||(!t.dueDate&&isThisWeek(t.createdAt)))
      : todoDueFilter==="upcoming" ? memberFiltered.filter(t=>t.dueDate&&!isThisWeek(t.dueDate)&&!isOverdue(t.dueDate))
      : memberFiltered.filter(t=>!t.dueDate);
    const isFiltered = todoProjectFilter!=="__all__" || todoDueFilter!=="all" || todoMemberFilter!=="__all__";
    return (
    <Shell>
      {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
      <GlobalPickers/>
      <SearchEl/>
      <BottomSearchBar onClick={()=>setShowSearch(true)}/>
      <Nav/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <SectionTitle>My Tasks</SectionTitle>
        <div style={{display:"flex",gap:6}}>
          {["pending","done"].map(f=>(
            <button key={f} onClick={()=>setTodoFilter(f)} style={{padding:"4px 12px",fontSize:"12px",fontWeight:todoFilter===f?600:400,color:todoFilter===f?T.accent:T.mid,background:todoFilter===f?T.accentLight:"transparent",border:`1px solid ${todoFilter===f?T.accent:T.border}`,borderRadius:2,cursor:"pointer",fontFamily:T.sans}}>
              {f==="pending"?`Pending (${pendingTodos.length})`:`Done (${doneTodos.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
        <select value={todoProjectFilter} onChange={e=>setTodoProjectFilter(e.target.value)} style={{...inp,width:"auto",fontSize:"12px",padding:"5px 8px"}}>
          <option value="__all__">All projects</option>
          <option value="__none__">No project</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={todoDueFilter} onChange={e=>setTodoDueFilter(e.target.value)} style={{...inp,width:"auto",fontSize:"12px",padding:"5px 8px"}}>
          <option value="all">All due dates</option>
          <option value="overdue">Overdue</option>
          <option value="thisweek">This week</option>
          <option value="upcoming">Upcoming</option>
          <option value="noduedate">No due date</option>
        </select>
        {members.length>0&&<select value={todoMemberFilter} onChange={e=>setTodoMemberFilter(e.target.value)} style={{...inp,width:"auto",fontSize:"12px",padding:"5px 8px"}}>
          <option value="__all__">All assignees</option>
          {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
        </select>}
        {isFiltered&&<button onClick={()=>{setTodoProjectFilter("__all__");setTodoDueFilter("all");setTodoMemberFilter("__all__");}} style={{fontSize:"11px",color:T.danger,background:"none",border:"none",cursor:"pointer",fontFamily:T.sans,padding:0}}>✕ Clear filters</button>}
        <span style={{fontSize:"11px",color:T.muted,marginLeft:"auto"}}>{dueFiltered.length} task{dueFiltered.length!==1?"s":""}</span>
      </div>

      <Card>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div style={{flex:"1 1 140px"}}><Label>Task</Label><input value={newTodoText} onChange={e=>setNewTodoText(e.target.value)} placeholder="Add a task…" onKeyDown={e=>e.key==="Enter"&&addTodo()} style={inp}/></div>
          <div style={{flex:"1 1 110px"}}>
            <Label>Project</Label>
            <select value={newTodoProjectId} onChange={e=>setNewTodoProjectId(e.target.value)} style={{...inp}}>
              <option value="__none__">No project</option>
              {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{flex:"1 1 110px"}}><Label>Assign to</Label><select value={newTodoMemberId} onChange={e=>setNewTodoMemberId(e.target.value)} style={{...inp}}><option value="">Myself</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div style={{flex:"0 0 auto"}}><Label>Due</Label><input type="date" value={newTodoDue} onChange={e=>setNewTodoDue(e.target.value)} style={{...inp,width:"auto"}}/></div>
          <Btn onClick={addTodo} disabled={!newTodoText.trim()}>Add</Btn>
        </div>
      </Card>

      {/* When filters active: flat list */}
      {isFiltered ? (
        dueFiltered.length===0
          ? <Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No tasks match these filters.</p></Card>
          : <Card>{dueFiltered.map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo} onEdit={editTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}} onReassignProject={(id,cur)=>setReassignTodo({id,currentProjectId:cur})}/>)}</Card>
      ) : todoFilter==="pending" ? (<>
        {overdueTodos.length>0&&<><GroupLabel color={T.danger}>Overdue</GroupLabel><Card>{overdueTodos.map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo} onEdit={editTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}} onReassignProject={(id,cur)=>setReassignTodo({id,currentProjectId:cur})}/>)}</Card></>}
        {thisWeekTodos.length>0&&<><GroupLabel>This Week</GroupLabel><Card>{thisWeekTodos.map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo} onEdit={editTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}} onReassignProject={(id,cur)=>setReassignTodo({id,currentProjectId:cur})}/>)}</Card></>}
        {upcomingTodos.length>0&&<><GroupLabel>Upcoming</GroupLabel><Card>{upcomingTodos.map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo} onEdit={editTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}} onReassignProject={(id,cur)=>setReassignTodo({id,currentProjectId:cur})}/>)}</Card></>}
        {undatedTodos.length>0&&<><GroupLabel>No Date</GroupLabel><Card>{undatedTodos.map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo} onEdit={editTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}} onReassignProject={(id,cur)=>setReassignTodo({id,currentProjectId:cur})}/>)}</Card></>}
        {pendingTodos.length===0&&<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>All caught up.</p></Card>}
      </>) : (
        doneTodos.length===0?<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No completed tasks yet.</p></Card>:<Card>{[...doneTodos].reverse().map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo} onEdit={editTodo} onReassignProject={(id,cur)=>setReassignTodo({id,currentProjectId:cur})}/>)}</Card>
      )}
    </Shell>
    );
  }

  // ── TEAM ──────────────────────────────────────────────────────────────────
  if(view==="team") return (
    <Shell>
      {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
      <GlobalPickers/>
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
            return <MemberCard key={m.id} m={m} nc={nc} openComm={openComm} onView={()=>{setActiveMemberId(m.id);setView("memberView");}} onShare={()=>generateShareLink(m.id)} onEdit={editMember} onDelete={deleteMember}/>;
          })}
        </div>}
    </Shell>
  );

  // ── MEMBER VIEW ───────────────────────────────────────────────────────────
  if(view==="memberView"&&activeMember) return (
    <Shell>
      {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
      <GlobalPickers/>
      <SearchEl/>
      <BottomSearchBar onClick={()=>setShowSearch(true)}/>
      <Nav/>
      <button onClick={()=>setView("team")} style={{fontSize:"12px",color:T.mid,background:"none",border:"none",cursor:"pointer",padding:"0 0 16px",fontFamily:T.sans}}>← Team</button>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,flexWrap:"wrap"}}>
        <Av name={activeMember.name} size={44}/>
        <div style={{flex:1,minWidth:0}}><h1 style={{margin:0,fontFamily:T.serif,fontSize:"20px",fontWeight:700,color:T.ink}}>{activeMember.name}</h1>{activeMember.role&&<p style={{margin:"2px 0 0",fontSize:"13px",color:T.mid}}>{activeMember.role}</p>}</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <Btn variant="secondary" size="sm" onClick={()=>generateMemberSummary(activeMember.id)} disabled={memberLoading}>{memberLoading?"Updating…":activeMember.summary?"↻ Refresh":"Generate"}</Btn>
          <Btn variant="secondary" size="sm" onClick={()=>generateShareLink(activeMember.id)}>🔗 Share tasks</Btn>
          <Btn variant="danger" size="sm" onClick={()=>{deleteMember(activeMember.id);setView("team");}}>Remove</Btn>
        </div>
      </div>
      {activeMember.intelligence&&(<Card style={{marginBottom:10,background:T.accentLight,border:`1px solid ${T.accentMid}30`}}><h3 style={{margin:"0 0 8px",fontSize:"13px",fontWeight:700,color:T.accent,letterSpacing:"0.04em",textTransform:"uppercase"}}>Stakeholder Intelligence</h3><p style={{margin:0,fontSize:"13px",color:T.ink,lineHeight:1.6,textAlign:"left"}}>{activeMember.intelligence}</p></Card>)}
      <Card accent={avatarBg(activeMember.name)}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
          <h2 style={{margin:0,fontFamily:T.serif,fontSize:"15px",fontWeight:700,color:T.ink}}>Activity Summary</h2>
          {activeMember.summary_updated_at&&<span style={{fontSize:"11px",color:T.muted}}>{fmt(activeMember.summary_updated_at)}</span>}
        </div>
        {memberLoading?<p style={{color:T.muted,fontSize:"13px"}}>Generating…</p>:activeMember.summary?<MD content={activeMember.summary} small/>:<p style={{color:T.muted,fontSize:"13px",margin:0}}>Tag @{activeMember.name} in notes or click Generate.</p>}
      </Card>
      {(()=>{
        const mc=projects.flatMap(p=>(p.commitments||[]).filter(c=>c.member_id===activeMember.id).map(c=>({...c,projectName:p.name})));
        if(!mc.length) return null;
        const total=mc.length;
        const done=mc.filter(c=>c.status==="done").length;
        const open=mc.filter(c=>c.status==="open").length;
        const pct=total>0?Math.round((done/total)*100):0;
        const reliabilityColor=pct>=80?T.success:pct>=50?"#F59E0B":T.danger;
        const reliabilityLabel=pct>=80?"Reliable":pct>=50?"Inconsistent":"Needs attention";
        // avg days to close
        const closedWithDays=mc.filter(c=>c.status==="done"&&c.date).map(c=>{ const d=new Date(c.date); const now=new Date(); return Math.max(0,Math.floor((now-d)/(1000*60*60*24))); });
        const avgDays=closedWithDays.length>0?Math.round(closedWithDays.reduce((a,b)=>a+b,0)/closedWithDays.length):null;
        return(
          <Card style={{marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <h3 style={{margin:0,fontSize:"13px",fontWeight:700,color:T.ink}}>Commitment Reliability</h3>
              <span style={{fontSize:"12px",fontWeight:700,color:reliabilityColor,background:reliabilityColor+"15",padding:"2px 8px",borderRadius:3}}>{reliabilityLabel}</span>
            </div>
            <div style={{display:"flex",gap:20,marginBottom:12}}>
              <div style={{textAlign:"center"}}><div style={{fontSize:"22px",fontWeight:700,color:reliabilityColor}}>{pct}%</div><div style={{fontSize:"11px",color:T.muted}}>follow-through</div></div>
              <div style={{textAlign:"center"}}><div style={{fontSize:"22px",fontWeight:700,color:T.ink}}>{total}</div><div style={{fontSize:"11px",color:T.muted}}>total</div></div>
              <div style={{textAlign:"center"}}><div style={{fontSize:"22px",fontWeight:700,color:T.success}}>{done}</div><div style={{fontSize:"11px",color:T.muted}}>closed</div></div>
              <div style={{textAlign:"center"}}><div style={{fontSize:"22px",fontWeight:700,color:open>0?T.warning:T.muted}}>{open}</div><div style={{fontSize:"11px",color:T.muted}}>open</div></div>
              {avgDays!==null&&<div style={{textAlign:"center"}}><div style={{fontSize:"22px",fontWeight:700,color:T.ink}}>{avgDays}d</div><div style={{fontSize:"11px",color:T.muted}}>avg to close</div></div>}
            </div>
            <div style={{background:T.border,borderRadius:2,height:5,marginBottom:12,overflow:"hidden"}}>
              <div style={{background:reliabilityColor,height:"100%",width:`${pct}%`,borderRadius:2}}/>
            </div>
            <h4 style={{margin:"0 0 6px",fontSize:"12px",fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>All commitments</h4>
            {mc.map(c=>(
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
      {(()=>{ const mentions=[]; for(const p of projects) for(const n of p.notes) if(n.taggedMembers?.includes(activeMember.id)||n.raw.toLowerCase().includes(activeMember.name.toLowerCase())) mentions.push({...n,projectName:p.name,projIdx:projects.findIndex(pp=>pp.name===p.name)}); if(!mentions.length) return <Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No notes mention this person yet.</p></Card>; return(<><GroupLabel>Meeting Notes ({mentions.length})</GroupLabel>{[...mentions].reverse().map(n=>(<Card key={n.id}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5,flexWrap:"wrap",gap:6}}><div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}><Tag color={pc(n.projIdx)}>{n.projectName}</Tag><span style={{fontSize:"11px",color:T.muted}}>{fmt(n.date)}</span></div><Btn variant="ghost" size="sm" onClick={()=>setExpandedNote(expandedNote===n.id?null:n.id)}>{expandedNote===n.id?"Hide":"View"}</Btn></div>{expandedNote===n.id?<MD content={n.summary} small/>:<p style={{fontSize:"12px",color:T.muted,margin:0,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{n.summary.replace(/[#*]/g,"").slice(0,100)}…</p>}</Card>))}</>); })()}
    </Shell>
  );

  // ── NEW PROJECT (FIX #7: context field) ──────────────────────────────────
  if(view==="newProject") return (
    <Shell maxW={480}>
      <Nav/>
      <SectionTitle>New Project</SectionTitle>
      <Card>
        <div style={{marginBottom:14}}>
          <Label>Project Name</Label>
          <input style={inp} value={newProjName} onChange={e=>setNewProjName(e.target.value)} placeholder="e.g. Product Launch Q2" onKeyDown={e=>e.key==="Enter"&&newProjContext===''&&createProject()}/>
        </div>
        <div style={{marginBottom:14}}>
          <Label>Deadline <span style={{fontSize:"10px",fontWeight:400,color:T.muted,textTransform:"none",letterSpacing:0}}>(optional — used to assess health score and risks)</span></Label>
          <input type="date" value={newProjDeadline} onChange={e=>setNewProjDeadline(e.target.value)} style={{...inp,width:"auto"}}/>
        </div>
        <div>
          <Label>Project Context <span style={{fontSize:"10px",fontWeight:400,color:T.muted,textTransform:"none",letterSpacing:0}}>(optional — helps Debrief ask fewer clarification questions)</span></Label>
          <textarea value={newProjContext} onChange={e=>setNewProjContext(e.target.value)} placeholder={`e.g. "This is a 6-month ERP rollout for a 200-person FMCG company. Key stakeholders: CFO and Head of Supply Chain. Main risks are data migration and change management. We use SAP and o9."`} style={{...inp,height:100,resize:"vertical",lineHeight:1.6,fontSize:"13px"}}/>
          <p style={{margin:"4px 0 0",fontSize:"11px",color:T.muted}}>This context will be included in every AI analysis for this project.</p>
        </div>
        <div style={{display:"flex",gap:8,marginTop:16}}>
          <Btn onClick={createProject} disabled={!newProjName.trim()}>Create Project</Btn>
          <Btn variant="secondary" onClick={()=>{setNewProjDeadline("");setView("home");}}>Cancel</Btn>
        </div>
      </Card>
    </Shell>
  );

  // ── PROJECT VIEW ──────────────────────────────────────────────────────────
  if(view==="project"&&activeProject) return (
    <Shell>
      {toast&&<Toast message={toast} onDone={()=>setToast(null)}/>}
      <GlobalPickers/>
      {showBriefing&&<PreMeetingBriefing project={activeProject} todos={todos} members={members} onClose={()=>setShowBriefing(false)}/>}
      <SearchEl/>
      {editingNote&&<EditNoteModal note={editingNote} projectName={activeProject.name} onSave={raw=>saveEditedNote(editingNote.id,raw)} onCancel={()=>setEditingNote(null)} saving={editSaving}/>}
      <BottomSearchBar onClick={()=>setShowSearch(true)}/>
      <Nav/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          <button onClick={()=>setView("home")} style={{fontSize:"12px",color:T.mid,background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:T.sans,flexShrink:0}}>← Home</button>
          <div style={{width:3,height:16,background:pc(activeIdx),flexShrink:0}}/>
          <h1 style={{margin:0,fontFamily:T.serif,fontSize:"19px",fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:T.ink}}>{activeProject.name}</h1>
          {activeProject.rag&&(
            <div onClick={()=>setRagPickerProjectId(activeProject.id)} style={{cursor:"pointer",display:"flex",alignItems:"center",gap:4}} title={`Health: ${RAG_LABELS[activeProject.rag]} — click to change`}>
              <RagDot rag={activeProject.rag} size={11}/>
              <span style={{fontSize:"11px",color:RAG_COLORS[activeProject.rag],fontWeight:600}}>{RAG_LABELS[activeProject.rag]}</span>
            </div>
          )}
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <Btn size="sm" variant="secondary" onClick={()=>setShowBriefing(true)}>⚡ Brief me</Btn>
          <Btn size="sm" onClick={()=>{setNotePhase("input");setNotes("");setError("");setTaggedMembers([]);setTaggedSelf(false);setView("addNote");}}>+ Add Notes</Btn>
          <Btn variant="danger" size="sm" onClick={()=>deleteProject(activeIdx)}>Delete</Btn>
        </div>
      </div>

      {/* Project context card — collapsible */}
      {(activeProject.context||editingContext)&&(
        <Card style={{marginBottom:10,background:"#FAFAF8",borderLeft:`3px solid ${T.accentMid}`,padding:"10px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <button onClick={()=>setEditingContext(v=>typeof v==="string"?false:v===false?"open":false)} style={{background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:6,padding:0,fontFamily:T.sans}}>
              <h3 style={{margin:0,fontSize:"11px",fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:T.accentMid}}>Project Context</h3>
              <span style={{fontSize:"10px",color:T.muted}}>{editingContext==="open"||editingContext===true?"▲":"▼"}</span>
            </button>
            <div style={{display:"flex",gap:8}}>
              {(editingContext==="open"||editingContext===true)&&!editingContext?.editing&&<button onClick={()=>setEditingContext("editing")} style={{background:"none",border:"none",cursor:"pointer",fontSize:"11px",color:T.mid,fontFamily:T.sans}}>Edit</button>}
            </div>
          </div>
          {editingContext==="editing"&&(
            <div style={{marginTop:8}}>
              <textarea value={contextDraft} onChange={e=>setContextDraft(e.target.value)} style={{...inp,height:80,resize:"vertical",lineHeight:1.6,fontSize:"13px",marginBottom:8}}/>
              <div style={{display:"flex",gap:8}}><Btn size="sm" onClick={saveContext}>Save</Btn><Btn size="sm" variant="secondary" onClick={()=>setEditingContext(false)}>Cancel</Btn></div>
            </div>
          )}
          {(editingContext==="open"||editingContext===true)&&editingContext!=="editing"&&(
            <p style={{margin:"6px 0 0",fontSize:"12px",color:T.mid,lineHeight:1.5}}>{activeProject.context}</p>
          )}
          {editingContext===false&&<p style={{margin:"4px 0 0",fontSize:"11px",color:T.muted,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{activeProject.context.slice(0,80)}{activeProject.context.length>80?"…":""}</p>}
        </Card>
      )}
      {!activeProject.context&&editingContext!=="editing"&&editingContext!=="open"&&editingContext!==true&&(
        <button onClick={()=>{setContextDraft("");setEditingContext("editing");}} style={{fontSize:"12px",color:T.muted,background:"none",border:"none",cursor:"pointer",fontFamily:T.sans,padding:"0 0 10px",display:"block"}}>+ Add project context (helps Debrief ask fewer questions)</button>
      )}

      {/* Deadline display + inline edit */}
      {(()=>{
        const dl = activeProject.deadline;
        const daysTo = dl ? Math.floor((new Date(dl)-Date.now())/(1000*60*60*24)) : null;
        const dlColor = daysTo===null ? T.muted : daysTo<0 ? T.danger : daysTo<=7 ? T.danger : daysTo<=21 ? T.warning : T.success;
        const dlLabel = daysTo===null ? "" : daysTo<0 ? `${Math.abs(daysTo)}d overdue` : daysTo===0 ? "today" : `${daysTo}d remaining`;
        return editingDeadline ? (
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
            <input type="date" defaultValue={dl||""} id="deadline-input" style={{...inp,width:"auto",fontSize:"13px"}}/>
            <Btn size="sm" onClick={async()=>{const v=document.getElementById("deadline-input").value;await db.updateProjectDeadline(activeProject.id,v||null);setData(d=>({...d,projects:d.projects.map(p=>p.id===activeProject.id?{...p,deadline:v||null}:p)}));setEditingDeadline(false);setToast("Deadline saved");}}>Save</Btn>
            <Btn size="sm" variant="secondary" onClick={()=>setEditingDeadline(false)}>Cancel</Btn>
          </div>
        ) : dl ? (
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <span style={{fontSize:"12px",color:T.mid}}>📅 Deadline:</span>
            <span style={{fontSize:"12px",fontWeight:600,color:dlColor}}>{fmt(dl)}</span>
            <span style={{fontSize:"11px",color:dlColor}}>({dlLabel})</span>
            <button onClick={()=>setEditingDeadline(true)} style={{background:"none",border:"none",cursor:"pointer",fontSize:"11px",color:T.muted,fontFamily:T.sans}}>Edit</button>
          </div>
        ) : (
          <button onClick={()=>setEditingDeadline(true)} style={{fontSize:"12px",color:T.muted,background:"none",border:"none",cursor:"pointer",fontFamily:T.sans,padding:"0 0 10px",display:"block"}}>+ Add project deadline (improves health score accuracy)</button>
        );
      })()}

      {/* FIX #2: Inline add task at top of project */}
      <InlineAddTask projectId={activeProject.id} userId={userId} members={members} onAdd={t=>{setData(d=>({...d,todos:[...d.todos,t]}));}}/>

      {todos.filter(t=>t.projectId===activeProject.id&&!t.done).length>0&&(
        <Card>
          <h3 style={{margin:"0 0 8px",fontSize:"13px",fontWeight:600,color:T.ink}}>Open Tasks</h3>
          {todos.filter(t=>t.projectId===activeProject.id&&!t.done).map(t=><TodoItem key={t.id} todo={t} projects={projects} members={members} onToggle={toggleTodo} onDelete={deleteTodo} onEdit={editTodo} onReassignProject={(id,cur)=>setReassignTodo({id,currentProjectId:cur})}/>)}
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
          ["stakeholders","Stakeholders"],
        ].map(([tab,label])=>(
          <button key={tab} onClick={()=>setActiveProjectTab(tab)} style={{padding:"7px 14px",fontSize:"12px",fontWeight:activeProjectTab===tab?700:400,color:activeProjectTab===tab?T.accent:T.mid,background:"transparent",border:"none",borderBottom:activeProjectTab===tab?`2px solid ${T.accent}`:"2px solid transparent",cursor:"pointer",fontFamily:T.sans,whiteSpace:"nowrap"}}>{label}</button>
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
                  {(tagged.length>0||n.selfTagged)&&(<div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>{n.selfTagged&&<Tag color={T.accent}>You</Tag>}{tagged.map(m=><Tag key={m.id} color={avatarBg(m.name)} onClick={()=>{setActiveMemberId(m.id);setView("memberView");}}>{m.name}</Tag>)}</div>)}
                </div>
                <div style={{display:"flex",gap:5,flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
                  <Btn variant="secondary" size="sm" onClick={()=>setExpandedNote(expandedNote===n.id?null:n.id)}>{expandedNote===n.id?"Hide":"View"}</Btn>
                  <Btn variant="secondary" size="sm" onClick={()=>setEditingNote(n)}>Edit</Btn>
                  <Btn variant="secondary" size="sm" onClick={()=>shareNote(n,activeProject.name)}>Share</Btn>
                  <Btn variant="danger" size="sm" onClick={()=>deleteNote(n.id)}>Del</Btn>
                </div>
              </div>
              {expandedNote===n.id?<div style={{borderTop:`1px solid ${T.border}`,paddingTop:10}}><MD content={n.summary} small/></div>:<p style={{fontSize:"12px",color:T.muted,margin:0,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{n.summary.replace(/[#*]/g,"").slice(0,110)}…</p>}
            </Card>
          );
        })
      )}

      {activeProjectTab==="decisions"&&(
        (activeProject.decisions||[]).length===0?<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No decisions extracted yet.</p></Card>
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
        (activeProject.commitments||[]).length===0?<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No commitments extracted yet.</p></Card>
        :[...activeProject.commitments].reverse().map(c=>{ const member=members.find(m=>m.id===c.member_id); return(
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
        );})
      )}

      {activeProjectTab==="risks"&&(
        (activeProject.risks||[]).filter(r=>!r.dismissed).length===0
          ?<Card>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <p style={{color:T.muted,fontSize:"13px",margin:0}}>No active risks.</p>
                {activeProject.notes.length>0&&<Btn size="sm" variant="secondary" onClick={async()=>{setRiskLoading(true);try{const d=await db.loadAll(userId);const p=d.projects.find(pp=>pp.id===activeProject.id);if(p)await reevaluateRisks(p.id,p,userId);await reload();}finally{setRiskLoading(false);}}} disabled={riskLoading}>{riskLoading?"Re-evaluating…":"↻ Re-evaluate"}</Btn>}
              </div>
            </Card>
          :<>
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:6}}>
              <Btn size="sm" variant="secondary" onClick={async()=>{setRiskLoading(true);try{const d=await db.loadAll(userId);const p=d.projects.find(pp=>pp.id===activeProject.id);if(p)await reevaluateRisks(p.id,p,userId);await reload();}finally{setRiskLoading(false);}}} disabled={riskLoading}>{riskLoading?"Re-evaluating…":"↻ Re-evaluate risks"}</Btn>
            </div>
            {(activeProject.risks||[]).filter(r=>!r.dismissed).map(r=>(
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
            ))}
          </>
      )}

      {/* #6 Stakeholder Map */}
      {activeProjectTab==="stakeholders"&&(()=>{
        const projMembers = members.filter(m=>
          activeProject.notes.some(n=>n.taggedMembers?.includes(m.id)||n.raw?.toLowerCase().includes(m.name.toLowerCase()))
        );
        if(projMembers.length===0) return <Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No team members tagged in notes yet. Use @name in your meeting notes.</p></Card>;
        return (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
            {projMembers.map(m=>{
              const mc=projects.flatMap(p=>(p.commitments||[]).filter(c=>c.member_id===m.id));
              const projComm=activeProject.commitments.filter(c=>c.member_id===m.id);
              const done=projComm.filter(c=>c.status==="done").length;
              const total=projComm.length;
              const pct=total>0?Math.round((done/total)*100):null;
              const relColor=pct===null?T.muted:pct>=80?"#16A34A":pct>=50?"#F59E0B":"#DC2626";
              const mentions=activeProject.notes.filter(n=>n.taggedMembers?.includes(m.id)||n.raw?.toLowerCase().includes(m.name.toLowerCase())).length;
              const lastMention=activeProject.notes.filter(n=>n.taggedMembers?.includes(m.id)).sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
              return (
                <Card key={m.id} style={{marginBottom:0,cursor:"pointer"}} onClick={()=>{setActiveMemberId(m.id);setView("memberView");}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                    <Av name={m.name} size={32}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:"13px",color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name}</div>
                      {m.role&&<div style={{fontSize:"11px",color:T.muted}}>{m.role}</div>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:12,fontSize:"11px",color:T.muted,marginBottom:6}}>
                    <span>{mentions} mentions</span>
                    <span>{total} commitments</span>
                  </div>
                  {pct!==null&&(
                    <div>
                      <div style={{background:T.border,borderRadius:2,height:4,overflow:"hidden"}}>
                        <div style={{background:relColor,height:"100%",width:`${pct}%`,borderRadius:2}}/>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
                        <span style={{fontSize:"10px",color:relColor,fontWeight:600}}>{pct>=80?"Reliable":pct>=50?"Inconsistent":"Needs attention"}</span>
                        <span style={{fontSize:"10px",color:T.muted}}>{pct}%</span>
                      </div>
                    </div>
                  )}
                  {lastMention&&<div style={{fontSize:"10px",color:T.muted,marginTop:4}}>Last: {fmt(lastMention.date)}</div>}
                </Card>
              );
            })}
          </div>
        );
      })()}

      {/* #8 Context suggestion banner */}
      {contextSuggestion&&contextSuggestion.projectId===activeProject.id&&(
        <div style={{background:"#EFF6FF",border:"1px solid #BFDBFE",borderLeft:"3px solid #3B82F6",padding:"12px 16px",marginTop:10,fontFamily:T.sans}}>
          <div style={{fontSize:"12px",fontWeight:700,color:"#1E40AF",marginBottom:6}}>💡 Debrief noticed a context update</div>
          <p style={{margin:"0 0 10px",fontSize:"13px",color:"#1E3A8A"}}>{contextSuggestion.suggestion}</p>
          <div style={{display:"flex",gap:8}}>
            <Btn size="sm" onClick={async()=>{
              const newCtx = (activeProject.context?activeProject.context+"\n\n":"")+contextSuggestion.suggestion;
              await db.updateProjectContext(activeProject.id,newCtx);
              setData(d=>({...d,projects:d.projects.map(p=>p.id===activeProject.id?{...p,context:newCtx}:p)}));
              setContextSuggestion(null); setToast("Context updated");
            }}>Accept</Btn>
            <Btn size="sm" variant="secondary" onClick={()=>setContextSuggestion(null)}>Dismiss</Btn>
          </div>
        </div>
      )}
    </Shell>
  );

  // ── ADD NOTE ──────────────────────────────────────────────────────────────
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
