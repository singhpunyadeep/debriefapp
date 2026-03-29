import React, { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "./AuthWrapper.jsx";

const T = {
  bg: "#F5F4F0", white: "#FFFFFF", ink: "#1A1A1A", mid: "#6B6B6B",
  muted: "#A8A8A8", border: "#E0DFDB", accent: "#003366",
  accentLight: "#E8EEF5", accentMid: "#5580AA",
  danger: "#B91C1C",
  serif: "Georgia, 'Times New Roman', serif",
  sans: "Inter, 'Helvetica Neue', Arial, sans-serif",
};

const PROJ_COLORS = ["#003366","#5C4033","#1A4731","#4A1942","#7C3514","#1E3A5F","#2D4A3E","#4A3728"];
const pc = i => PROJ_COLORS[i % PROJ_COLORS.length];
const avatarBg = name => { let h=0; for(const c of name) h=(h*31+c.charCodeAt(0))%PROJ_COLORS.length; return PROJ_COLORS[h]; };
const initials = n => n.trim().split(/\s+/).map(w=>w[0].toUpperCase()).slice(0,2).join("");
const fmt = iso => new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
const fmtShort = iso => new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short"});
const isThisWeek = iso => { const d=new Date(iso),now=new Date(),s=new Date(now); s.setDate(now.getDate()-now.getDay()+1); const e=new Date(s); e.setDate(s.getDate()+6); return d>=s&&d<=e; };
const isNextWeek = iso => { const d=new Date(iso),now=new Date(),s=new Date(now); s.setDate(now.getDate()-now.getDay()+8); const e=new Date(s); e.setDate(s.getDate()+6); return d>=s&&d<=e; };
const isOverdue = iso => iso && new Date(iso)<new Date() && !isThisWeek(iso);

const claude = async (prompt, maxTokens=1500) => {
  const r = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:maxTokens, messages:[{role:"user",content:prompt}] })
  });
  const d = await r.json();
  return d.content.map(b=>b.text||"").join("");
};

const parseJsonSafe = raw => {
  try { return JSON.parse(raw.trim().replace(/^```json\s*/i,"").replace(/^```\s*/,"").replace(/```\s*$/,"").trim()); }
  catch { const m=raw.match(/\[[\s\S]*\]/); if(m){try{return JSON.parse(m[0]);}catch{}} return null; }
};

// ─── Supabase data functions ──────────────────────────────────────────────────
const db = {
  async getUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  },

  async loadAll(userId) {
    const [
      { data: projects },
      { data: notes },
      { data: members },
      { data: noteMembers },
      { data: todos },
      { data: homeSummary },
      { data: profile },
    ] = await Promise.all([
      supabase.from('projects').select('*').eq('user_id', userId).order('created_at'),
      supabase.from('notes').select('*').eq('user_id', userId).order('date'),
      supabase.from('members').select('*').eq('user_id', userId).order('created_at'),
      supabase.from('note_members').select('*'),
      supabase.from('todos').select('*').eq('user_id', userId).order('created_at'),
      supabase.from('home_summaries').select('*').eq('user_id', userId).single(),
      supabase.from('profiles').select('*').eq('id', userId).single(),
    ]);

    const projectsWithNotes = (projects||[]).map(p => ({
      ...p,
      statusUpdated: p.status_updated_at,
      notes: (notes||[]).filter(n=>n.project_id===p.id).map(n => ({
        ...n,
        selfTagged: n.self_tagged,
        taggedMembers: (noteMembers||[]).filter(nm=>nm.note_id===n.id).map(nm=>nm.member_id),
      })),
    }));

    return {
      projects: projectsWithNotes,
      members: members||[],
      todos: (todos||[]).map(t=>({...t, dueDate:t.due_date, projectId:t.project_id, doneAt:t.done_at})),
      me: profile?.name || null,
      homeWeeklySummary: homeSummary?.summary || null,
      homeWeeklySummaryDate: homeSummary?.updated_at || null,
    };
  },

  async createProject(userId, name) {
    const { data } = await supabase.from('projects').insert({ user_id:userId, name }).select().single();
    return { ...data, notes:[], status:null, statusUpdated:null };
  },

  async updateProjectStatus(projectId, status) {
    await supabase.from('projects').update({ status, status_updated_at:new Date().toISOString() }).eq('id', projectId);
  },

  async deleteProject(projectId) {
    await supabase.from('projects').delete().eq('id', projectId);
  },

  async createNote(userId, projectId, { raw, summary, selfTagged, taggedMemberIds }) {
    const { data: note } = await supabase.from('notes').insert({
      user_id:userId, project_id:projectId, raw, summary,
      self_tagged:selfTagged, date:new Date().toISOString(),
    }).select().single();
    if(taggedMemberIds?.length > 0) {
      await supabase.from('note_members').insert(taggedMemberIds.map(member_id=>({ note_id:note.id, member_id })));
    }
    return { ...note, selfTagged:note.self_tagged, taggedMembers:taggedMemberIds||[] };
  },

  async deleteNote(noteId) {
    await supabase.from('notes').delete().eq('id', noteId);
  },

  async createMember(userId, { name, role }) {
    const { data } = await supabase.from('members').insert({ user_id:userId, name, role }).select().single();
    return data;
  },

  async updateMemberSummary(memberId, summary) {
    await supabase.from('members').update({ summary, summary_updated_at:new Date().toISOString() }).eq('id', memberId);
  },

  async deleteMember(memberId) {
    await supabase.from('members').delete().eq('id', memberId);
  },

  async createTodo(userId, { text, dueDate, projectId, source='manual' }) {
    const { data } = await supabase.from('todos').insert({
      user_id:userId, text, due_date:dueDate||null, project_id:projectId||null, source,
    }).select().single();
    return { ...data, dueDate:data.due_date, projectId:data.project_id };
  },

  async toggleTodo(todoId, done) {
    await supabase.from('todos').update({ done, done_at:done?new Date().toISOString():null }).eq('id', todoId);
  },

  async deleteTodo(todoId) {
    await supabase.from('todos').delete().eq('id', todoId);
  },

  async upsertHomeSummary(userId, summary) {
    await supabase.from('home_summaries').upsert({ user_id:userId, summary, updated_at:new Date().toISOString() });
  },

  async setName(userId, name) {
    await supabase.from('profiles').upsert({ id:userId, name });
  },
};

// ─── UI primitives ────────────────────────────────────────────────────────────
const MD = ({ content, small }) => {
  const fs = small?"13px":"14px";
  const css = `.md h1{font-size:17px;font-weight:700;margin:12px 0 5px;font-family:${T.serif};color:${T.ink}}.md h2{font-size:15px;font-weight:700;margin:10px 0 4px;font-family:${T.serif};color:${T.ink}}.md h3{font-size:${fs};font-weight:600;margin:8px 0 3px;color:${T.ink}}.md strong{font-weight:600}.md ul,.md ol{margin:4px 0;padding-left:18px}.md li{margin:2px 0;font-size:${fs}}.md ul li{list-style-type:disc}.md ol li{list-style-type:decimal}.md p{margin:4px 0;font-size:${fs};line-height:1.6}`;
  const render = t => {
    let h=t.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/^### (.+)$/gm,"<h3>$1</h3>").replace(/^## (.+)$/gm,"<h2>$1</h2>").replace(/^# (.+)$/gm,"<h1>$1</h1>");
    const lines=h.split("\n"),out=[],stk=[];
    for(const line of lines){
      const bm=line.match(/^(\s*)[-*+] (.+)$/),nm=line.match(/^(\s*)\d+\.\s(.+)$/);
      if(bm||nm){const m=bm||nm,lvl=Math.floor(m[1].length/2),lt=bm?"ul":"ol";while(stk.length>lvl+1)out.push(`</${stk.pop()}>`);if(stk.length===lvl){out.push(`<${lt}>`);stk.push(lt);}out.push(`<li>${m[2]}</li>`);}
      else{while(stk.length)out.push(`</${stk.pop()}>`);out.push(line.trim()===""?"<br/>":line.match(/^<[^>]+>$/)?line:`<p>${line}</p>`);}
    }
    while(stk.length)out.push(`</${stk.pop()}>`);
    return out.join("");
  };
  return <><style>{css}</style><div className="md" dangerouslySetInnerHTML={{__html:render(content)}}/></>;
};

const Av = ({name,size=28,isSelf=false}) => (
  <div style={{width:size,height:size,borderRadius:"50%",background:isSelf?T.accent:avatarBg(name),color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:Math.floor(size*0.36),fontWeight:700,flexShrink:0}}>
    {initials(name)}
  </div>
);

const Btn = ({children,onClick,disabled,variant="primary",size="md"}) => {
  const pad=size==="sm"?"5px 10px":"9px 16px", fs=size==="sm"?"12px":"13px";
  const v={primary:{background:T.accent,color:"#fff",border:`1px solid ${T.accent}`},secondary:{background:"transparent",color:T.ink,border:`1px solid ${T.border}`},ghost:{background:"transparent",color:T.mid,border:"none"},danger:{background:"transparent",color:T.danger,border:`1px solid ${T.danger}`}};
  return <button onClick={onClick} disabled={disabled} style={{...v[variant],padding:pad,fontSize:fs,fontWeight:500,cursor:disabled?"not-allowed":"pointer",borderRadius:2,fontFamily:T.sans,opacity:disabled?0.5:1,whiteSpace:"nowrap",flexShrink:0}}>{children}</button>;
};

const Tag = ({color,children,onClick}) => (
  <span onClick={onClick} style={{display:"inline-flex",alignItems:"center",gap:3,background:color+"14",color,border:`1px solid ${color}30`,borderRadius:2,padding:"2px 6px",fontSize:"11px",fontWeight:600,letterSpacing:"0.03em",textTransform:"uppercase",cursor:onClick?"pointer":"default",whiteSpace:"nowrap",flexShrink:0}}>
    {children}
  </span>
);

const Card = ({children,accent,style={}}) => (
  <div style={{background:T.white,border:`1px solid ${T.border}`,borderLeft:accent?`3px solid ${accent}`:`1px solid ${T.border}`,padding:"16px 18px",marginBottom:10,fontFamily:T.sans,boxSizing:"border-box",...style}}>
    {children}
  </div>
);

const Label = ({children}) => (
  <p style={{margin:"0 0 5px",fontSize:"11px",fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:T.mid}}>{children}</p>
);

const inp = {width:"100%",padding:"9px 11px",border:`1px solid ${T.border}`,borderRadius:2,fontSize:"14px",color:T.ink,boxSizing:"border-box",fontFamily:T.sans,background:T.white,outline:"none"};

const Shell = ({children,maxW=820}) => (
  <div style={{fontFamily:T.sans,minHeight:"100vh",backgroundColor:T.bg,color:T.ink,boxSizing:"border-box",overflowX:"hidden"}}>
    <div style={{maxWidth:maxW,margin:"0 auto",padding:"28px 16px",boxSizing:"border-box"}}>{children}</div>
  </div>
);

const GroupLabel = ({children,color=T.mid}) => (
  <p style={{margin:"14px 0 6px",fontSize:"10px",fontWeight:700,letterSpacing:"0.09em",textTransform:"uppercase",color}}>{children}</p>
);

const NoteTextarea = ({ onSubmit, onCancel, loading, error, projectName, meName, members }) => {
  const ref = useRef(null);
  const [show, setShow] = useState(false);
  const [q, setQ] = useState("");
  const [dropPos, setDropPos] = useState(0);

  const all = useMemo(() => [
    {id:"me",name:meName,isSelf:true},
    ...members.map(m=>({...m,isSelf:false}))
  ], [meName, members]);

  const filtered = all.filter(m=>m.name.toLowerCase().includes(q.toLowerCase()));

  const handleChange = e => {
    const val=e.target.value, cur=e.target.selectionStart, before=val.slice(0,cur);
    const match=before.match(/@([\w][\w ]*)$/);
    if(match){setQ(match[1]);setShow(true);setDropPos(cur-match[0].length);}
    else setShow(false);
  };

  const insert = name => {
    const ta=ref.current, val=ta.value;
    const before=val.slice(0,dropPos), rest=val.slice(dropPos).replace(/^@[\w ]*/,"");
    ta.value=before+`@${name}`+(rest.startsWith(" ")?rest:" "+rest);
    setShow(false); ta.focus();
  };

  const loadExample = key => {
    ref.current.value = key==="meetingNotes"
      ? `Product Planning - Jan 15\nAttendees: Sarah (PM), Mike (Eng), Alex\n- Prioritize mobile app\n- Analytics dashboard to Q2\nActions: @${meName} review dashboard spec by Jan 20`
      : `[00:00] Standup. Sarah - dashboard?\n[00:25] Sarah: Auth done, 80% reporting. Ready Thursday.\n[00:45] Blocker: charts broken dark mode.\n[01:00] Mike: I'll help.\n[01:25] @${meName} to send sprint summary by EOD.`;
  };

  return (
    <Card>
      <div style={{marginBottom:14}}>
        <h2 style={{margin:0,fontSize:"18px",fontWeight:700,fontFamily:T.serif,color:T.ink}}>Add Meeting Notes</h2>
        <p style={{margin:"2px 0 0",fontSize:"12px",color:T.muted}}>Saving to: {projectName}</p>
      </div>
      <p style={{fontSize:"12px",color:T.muted,margin:"0 0 8px"}}>Type @ to tag people. Your action items will be auto-extracted.</p>
      <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
        {["meetingNotes","transcripts"].map(k=>(
          <button key={k} onClick={()=>loadExample(k)} style={{padding:"3px 10px",fontSize:"11px",border:`1px solid ${T.border}`,borderRadius:2,background:"transparent",color:T.mid,cursor:"pointer",fontFamily:T.sans}}>
            {k==="meetingNotes"?"Meeting notes":"Transcript"}
          </button>
        ))}
      </div>
      <div style={{position:"relative"}}>
        <textarea ref={ref} onChange={handleChange} placeholder="Paste raw notes, transcript, or bullets…"
          style={{...inp,height:180,resize:"vertical",lineHeight:1.65}}/>
        {show&&filtered.length>0&&(
          <div style={{position:"absolute",top:"100%",left:0,right:0,background:T.white,border:`1px solid ${T.border}`,borderRadius:2,boxShadow:"0 4px 12px rgba(0,0,0,0.08)",zIndex:20}}>
            {filtered.map(m=>(
              <div key={m.id} onMouseDown={e=>{e.preventDefault();insert(m.name);}}
                style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",cursor:"pointer",fontSize:"13px",color:T.ink,borderBottom:`1px solid ${T.border}`}}>
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

const TodoItem = ({todo,projects,onToggle,onDelete,onProjectNav}) => {
  const proj=todo.projectId?projects.find(p=>p.id===todo.projectId):null;
  const projIdx=proj?projects.findIndex(p=>p.id===todo.projectId):-1;
  const overdue=!todo.done&&isOverdue(todo.dueDate);
  return (
    <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 0",borderBottom:`1px solid ${T.border}`}}>
      <input type="checkbox" checked={!!todo.done} onChange={()=>onToggle(todo.id)} style={{marginTop:3,accentColor:T.accent,cursor:"pointer",flexShrink:0}}/>
      <div style={{flex:1,minWidth:0}}>
        <p style={{margin:0,fontSize:"13px",color:T.ink,textDecoration:todo.done?"line-through":"none",lineHeight:1.5,wordBreak:"break-word"}}>{todo.text}</p>
        <div style={{display:"flex",gap:5,marginTop:3,flexWrap:"wrap",alignItems:"center"}}>
          {proj&&<Tag color={pc(projIdx)} onClick={()=>onProjectNav&&onProjectNav(projIdx)}>{proj.name}</Tag>}
          {todo.dueDate&&<span style={{fontSize:"11px",color:overdue?T.danger:T.muted,fontWeight:overdue?600:400}}>{overdue?"Overdue · ":""}{fmtShort(todo.dueDate)}</span>}
          {todo.source==="ai"&&<span style={{fontSize:"10px",color:T.muted,letterSpacing:"0.05em"}}>AUTO</span>}
        </div>
      </div>
      <button onClick={()=>onDelete(todo.id)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:14,padding:"0 2px",flexShrink:0}}>✕</button>
    </div>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [userId, setUserId] = useState(null);
  const [data, setData] = useState(null);
  const [view, setView] = useState("home");
  const [activeIdx, setActiveIdx] = useState(null);
  const [activeMemberId, setActiveMemberId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [homeLoading, setHomeLoading] = useState(false);
  const [memberLoading, setMemberLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedNote, setExpandedNote] = useState(null);
  const [newProjName, setNewProjName] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("");
  const [meName, setMeName] = useState("");
  const [notes, setNotes] = useState("");
  const [taggedSelf, setTaggedSelf] = useState(false);
  const [taggedMembers, setTaggedMembers] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [notePhase, setNotePhase] = useState("input");
  const [newTodoText, setNewTodoText] = useState("");
  const [newTodoDue, setNewTodoDue] = useState("");
  const [todoFilter, setTodoFilter] = useState("pending");

  useEffect(()=>{
    db.getUser().then(user => {
      if(user) {
        setUserId(user.id);
        db.loadAll(user.id).then(d => {
          setData(d);
          if(d.me) setMeName(d.me);
        });
      }
    });
  },[]);

  const projects = data?.projects||[];
  const members = data?.members||[];
  const todos = data?.todos||[];
  const activeProject = activeIdx!==null?projects[activeIdx]:null;
  const activeMember = activeMemberId?members.find(m=>m.id===activeMemberId):null;

  const reload = async () => {
    if(!userId) return;
    const d = await db.loadAll(userId);
    setData(d);
    return d;
  };

  const meInNotes = text => data?.me&&text.toLowerCase().includes(data.me.toLowerCase());
  const extractMentions = text => members.filter(m=>text.toLowerCase().includes(m.name.toLowerCase())||text.includes(`@${m.name}`));

  const saveMe = async () => {
    if(!meName.trim()||!userId) return;
    await db.setName(userId, meName.trim());
    setData(d=>({...d,me:meName.trim()}));
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  const generateHomeSummary = async () => {
    if(!userId) return;
    setHomeLoading(true);
    try {
      const d = data;
      const myTodos=(d.todos||[]).filter(t=>t.done||isThisWeek(t.dueDate)||isThisWeek(t.createdAt));
      const recentNotes=[];
      for(const p of d.projects) for(const n of p.notes) if(isThisWeek(n.date)||meInNotes(n.raw)) recentNotes.push({project:p.name,date:n.date,summary:n.summary});
      const nextTodos=(d.todos||[]).filter(t=>!t.done&&(isNextWeek(t.dueDate)||!t.dueDate)).slice(0,8);
      const prompt=`Generate a weekly executive briefing for ${d.me||"the user"}.
This week's meetings:\n${recentNotes.length>0?recentNotes.map(n=>`[${n.project}] ${fmt(n.date)}: ${n.summary.slice(0,250)}`).join("\n"):"None."}
My tasks:\n${myTodos.length>0?myTodos.map(t=>`[${t.done?"DONE":"PENDING"}] ${t.text}`).join("\n"):"None."}
Next week:\n${nextTodos.length>0?nextTodos.map(t=>`- ${t.text}`).join("\n"):"Nothing."}
Write:
## This Week
2-3 sentences on accomplishments.
## Open Items
Bullet list.
## Next Week
3-5 actions.`;
      const summary=await claude(prompt,700);
      await db.upsertHomeSummary(userId, summary);
      await reload();
    }catch{}
    finally{setHomeLoading(false);}
  };

  const addTodo = async () => {
    if(!newTodoText.trim()||!userId) return;
    const t = await db.createTodo(userId, {
      text:newTodoText.trim(), dueDate:newTodoDue||null,
      projectId:activeIdx!==null?activeProject.id:null, source:'manual'
    });
    setData(d=>({...d,todos:[...d.todos,t]}));
    setNewTodoText(""); setNewTodoDue("");
  };

  const extractTodosFromNote = async (summary, projectId) => {
    if(!data?.me||!userId) return [];
    try{
      const raw=await claude(`Extract action items for "${data.me}" from this summary. Return ONLY a JSON array of strings. If none, return [].\n${summary}`,300);
      const items=parseJsonSafe(raw);
      if(!Array.isArray(items)||items.length===0) return [];
      const existing=new Set(todos.map(t=>t.text.toLowerCase()));
      const fresh=items.filter(t=>!existing.has(t.toLowerCase()));
      const created=await Promise.all(fresh.map(text=>db.createTodo(userId,{text,projectId,source:'ai'})));
      return created;
    }catch{return [];}
  };

  const toggleTodo = async id => {
    const todo=todos.find(t=>t.id===id); if(!todo) return;
    const nowDone=!todo.done;
    await db.toggleTodo(id, nowDone);
    setData(d=>({...d,todos:d.todos.map(t=>t.id===id?{...t,done:nowDone}:t)}));
    if(nowDone&&todo.projectId){
      const pIdx=projects.findIndex(p=>p.id===todo.projectId);
      if(pIdx>=0&&projects[pIdx].notes.length>0){
        try{
          const s=await claude(`Latest status for "${projects[pIdx].name}". Note: "${todo.text}" just completed.\n${projects[pIdx].notes.map((n,i)=>`Meeting ${i+1}:\n${n.summary}`).join("\n\n")}`,700);
          await db.updateProjectStatus(todo.projectId, s);
          await reload();
        }catch{}
      }
    }
  };

  const deleteTodo = async id => {
    await db.deleteTodo(id);
    setData(d=>({...d,todos:d.todos.filter(t=>t.id!==id)}));
  };

  const addMember = async () => {
    if(!newMemberName.trim()||!userId) return;
    const m=await db.createMember(userId,{name:newMemberName.trim(),role:newMemberRole.trim()});
    setData(d=>({...d,members:[...d.members,m]}));
    setNewMemberName(""); setNewMemberRole("");
  };

  const deleteMember = async id => {
    await db.deleteMember(id);
    setData(d=>({...d,members:d.members.filter(m=>m.id!==id)}));
  };

  const generateMemberSummary = async memberId => {
    setMemberLoading(true);
    try{
      const member=members.find(m=>m.id===memberId); if(!member) return;
      const mentions=[];
      for(const p of projects) for(const n of p.notes) if(n.raw.toLowerCase().includes(member.name.toLowerCase())||n.taggedMembers?.includes(member.id)) mentions.push({project:p.name,date:n.date,summary:n.summary});
      const summary=mentions.length===0?"No notes mention this person yet.":await claude(`Summarise ${member.name}'s activity.\n\n${mentions.map(m=>`[${m.project}] ${fmt(m.date)}:\n${m.summary}`).join("\n\n---\n\n")}`,900);
      await db.updateMemberSummary(memberId, summary);
      await reload();
    }catch{}
    finally{setMemberLoading(false);}
  };

  const createProject = async () => {
    if(!newProjName.trim()||!userId) return;
    const p=await db.createProject(userId, newProjName.trim());
    setData(d=>({...d,projects:[...d.projects,p]}));
    setActiveIdx(data.projects.length);
    setNewProjName(""); setView("project");
  };

  const buildPriorCtx = proj => {
    if(!proj||proj.notes.length===0) return "";
    const parts=[];
    if(proj.status) parts.push(`Status:\n${proj.status}`);
    proj.notes.slice(-3).forEach(n=>parts.push(`[${fmt(n.date)}]\n${n.summary}`));
    return parts.join("\n\n");
  };

  const analyseNote = async notesVal => {
    if(!notesVal.trim()){setError("Please enter notes.");return;}
    setNotes(notesVal); setError(""); setLoading(true);
    const mentioned=extractMentions(notesVal);
    const selfTagged=meInNotes(notesVal);
    setTaggedMembers(mentioned); setTaggedSelf(selfTagged);
    try{
      const prior=buildPriorCtx(activeProject);
      const prompt=`Review new meeting notes.${prior?` Existing context:\n${prior}\n\n`:" "}Identify up to 3 things STILL unclear. Return [] if clear. Respond with ONLY a valid JSON array of strings.\n\nNotes:\n${notesVal}`;
      const raw=await claude(prompt,400);
      const qs=parseJsonSafe(raw);
      if(!qs||!Array.isArray(qs)||qs.length===0){await finaliseNote(notesVal,{},mentioned,selfTagged);}
      else{setQuestions(qs);setAnswers(Object.fromEntries(qs.map((_,i)=>[i,""])));setNotePhase("clarifying");}
    }catch{await finaliseNote(notesVal,{},mentioned,selfTagged);}
    finally{setLoading(false);}
  };

  const finaliseNote = async (notesVal,ans,mentionedOvr,selfOvr) => {
    setLoading(true); setError("");
    const n=notesVal||notes;
    const mentioned=mentionedOvr||taggedMembers;
    const selfMentioned=selfOvr??taggedSelf;
    try{
      const clarifs=questions.length>0?"\n\nClarifications:\n"+questions.map((q,i)=>ans[i]?`Q: ${q}\nA: ${ans[i]}`:null).filter(Boolean).join("\n"):"";
      const summary=await claude(`Convert to structured summary:\n1. Overview\n2. Key decisions\n3. Action items\n4. Discussion\n5. Next steps\nUse markdown.\n\nNotes:\n${n}${clarifs}`,1200);

      const entry=await db.createNote(userId, activeProject.id, {
        raw:n, summary, selfTagged:selfMentioned,
        taggedMemberIds:mentioned.map(m=>m.id),
      });

      const d=await reload();
      const proj=d.projects.find(p=>p.id===activeProject.id);
      if(proj){
        const allS=proj.notes.map((n,i)=>`Meeting ${i+1} (${fmt(n.date)}):\n${n.summary}`).join("\n\n");
        const status=await claude(`Latest status for "${proj.name}". Current state, open actions, decisions, blockers, next steps.\n${allS}`,700);
        await db.updateProjectStatus(proj.id, status);
      }

      if(selfMentioned) await extractTodosFromNote(summary, activeProject.id);

      for(const m of mentioned){
        const allM=[];
        for(const p of (d.projects||[])){
          for(const note of p.notes){
            if(note.raw.toLowerCase().includes(m.name.toLowerCase())||note.taggedMembers?.includes(m.id))
              allM.push({project:p.name,date:note.date,summary:note.summary});
          }
        }
        if(allM.length>0){
          try{
            const ms=await claude(`Summarise ${m.name}'s activity.\n\n${allM.map(a=>`[${a.project}] ${fmt(a.date)}:\n${a.summary}`).join("\n\n---\n\n")}`,700);
            await db.updateMemberSummary(m.id, ms);
          }catch{}
        }
      }

      await reload();
      setNotes(""); setQuestions([]); setAnswers({}); setTaggedMembers([]); setTaggedSelf(false); setNotePhase("input");
      setView("project");
    }catch(e){setError("Failed to save. Please try again."); console.error(e);}
    finally{setLoading(false);}
  };

  const deleteNote = async noteId => {
    await db.deleteNote(noteId);
    const d=await reload();
    const proj=d.projects.find(p=>p.id===activeProject.id);
    if(proj&&proj.notes.length>0){
      try{
        const status=await claude(`Latest status for "${proj.name}":\n${proj.notes.map((n,i)=>`Meeting ${i+1}:\n${n.summary}`).join("\n\n")}`,700);
        await db.updateProjectStatus(proj.id, status);
        await reload();
      }catch{}
    }
  };

  const deleteProject = async idx => {
    await db.deleteProject(projects[idx].id);
    await reload();
    setView("home"); setActiveIdx(null);
  };

  const pendingTodos=todos.filter(t=>!t.done);
  const doneTodos=todos.filter(t=>t.done);
  const overdueTodos=pendingTodos.filter(t=>isOverdue(t.dueDate));
  const thisWeekTodos=pendingTodos.filter(t=>isThisWeek(t.dueDate)||(!t.dueDate&&isThisWeek(t.createdAt)));
  const upcomingTodos=pendingTodos.filter(t=>!isThisWeek(t.dueDate)&&!isOverdue(t.dueDate)&&t.dueDate);
  const undatedTodos=pendingTodos.filter(t=>!t.dueDate&&!isThisWeek(t.createdAt));

  const Nav = () => (
    <div style={{marginBottom:24,paddingBottom:14,borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
      <div style={{display:"flex",gap:0,flexWrap:"wrap"}}>
        {[["home","Overview"],["todos","My Tasks"],["team","Team"]].map(([v,label])=>(
          <button key={v} onClick={()=>setView(v)} style={{padding:"5px 12px",fontSize:"13px",fontWeight:view===v?700:400,color:view===v?T.accent:T.mid,background:"transparent",border:"none",borderBottom:view===v?`2px solid ${T.accent}`:"2px solid transparent",cursor:"pointer",fontFamily:T.sans}}>
            {label}
          </button>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {data?.me&&<div style={{display:"flex",alignItems:"center",gap:5}}><Av name={data.me} size={22} isSelf/><span style={{fontSize:"12px",color:T.mid}}>{data.me}</span></div>}
        <Btn size="sm" onClick={()=>{setNewProjName("");setView("newProject");}}>+ Project</Btn>
        <Btn size="sm" variant="secondary" onClick={signOut}>Sign out</Btn>
      </div>
    </div>
  );

  const SectionTitle = ({children,sub}) => (
    <div style={{marginBottom:14}}>
      <h2 style={{margin:0,fontSize:"18px",fontWeight:700,fontFamily:T.serif,color:T.ink,letterSpacing:"-0.01em"}}>{children}</h2>
      {sub&&<p style={{margin:"2px 0 0",fontSize:"12px",color:T.muted}}>{sub}</p>}
    </div>
  );

  if(!data) return (
    <Shell>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"60vh"}}>
        <p style={{color:T.muted}}>Loading your workspace…</p>
      </div>
    </Shell>
  );

  if(!data.me) return (
    <Shell maxW={400}>
      <div style={{paddingTop:60,textAlign:"center"}}>
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

  if(view==="home") return (
    <Shell>
      <Nav/>
      <Card accent={T.accent} style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,gap:8,flexWrap:"wrap"}}>
          <div>
            <h2 style={{margin:0,fontFamily:T.serif,fontSize:"16px",fontWeight:700}}>Weekly Briefing</h2>
            {data.homeWeeklySummaryDate&&<p style={{margin:"2px 0 0",fontSize:"11px",color:T.muted}}>Updated {fmt(data.homeWeeklySummaryDate)}</p>}
          </div>
          <Btn variant="secondary" size="sm" onClick={generateHomeSummary} disabled={homeLoading}>{homeLoading?"Updating…":data.homeWeeklySummary?"↻ Refresh":"Generate"}</Btn>
        </div>
        {homeLoading?<p style={{color:T.muted,fontSize:"13px"}}>Generating…</p>
          :data.homeWeeklySummary?<MD content={data.homeWeeklySummary} small/>
          :<p style={{color:T.muted,fontSize:"13px",margin:0}}>Click Generate for your weekly summary.</p>}
      </Card>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Card>
          <h3 style={{margin:"0 0 10px",fontSize:"13px",fontWeight:600}}>This Week <span style={{fontSize:"11px",fontWeight:400,color:T.muted}}>({thisWeekTodos.length+overdueTodos.length})</span></h3>
          {[...overdueTodos.slice(0,2),...thisWeekTodos.slice(0,3)].map(t=><TodoItem key={t.id} todo={t} projects={projects} onToggle={toggleTodo} onDelete={deleteTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}}/>)}
          {thisWeekTodos.length===0&&overdueTodos.length===0&&<p style={{fontSize:"12px",color:T.muted,margin:0}}>No tasks due this week.</p>}
        </Card>
        <Card>
          <h3 style={{margin:"0 0 10px",fontSize:"13px",fontWeight:600}}>Projects <span style={{fontSize:"11px",fontWeight:400,color:T.muted}}>({projects.length})</span></h3>
          {projects.length===0?<p style={{fontSize:"12px",color:T.muted,margin:0}}>No projects yet.</p>
            :projects.slice(0,6).map((p,i)=>(
              <div key={p.id} onClick={()=>{setActiveIdx(i);setView("project");}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${T.border}`,cursor:"pointer"}}>
                <div style={{display:"flex",alignItems:"center",gap:7,minWidth:0}}>
                  <div style={{width:3,height:14,background:pc(i),flexShrink:0}}/>
                  <span style={{fontSize:"13px",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
                </div>
                <span style={{fontSize:"11px",color:T.muted,flexShrink:0,marginLeft:6}}>{p.notes.length}</span>
              </div>
            ))}
        </Card>
      </div>
    </Shell>
  );

  if(view==="todos") return (
    <Shell>
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
          <div style={{flex:"1 1 160px"}}><Label>Task</Label><input value={newTodoText} onChange={e=>setNewTodoText(e.target.value)} placeholder="Add a task…" onKeyDown={e=>e.key==="Enter"&&addTodo()} style={inp}/></div>
          <div><Label>Due</Label><input type="date" value={newTodoDue} onChange={e=>setNewTodoDue(e.target.value)} style={{...inp,width:"auto"}}/></div>
          <Btn onClick={addTodo} disabled={!newTodoText.trim()}>Add</Btn>
        </div>
      </Card>
      {todoFilter==="pending"&&(<>
        {overdueTodos.length>0&&<><GroupLabel color={T.danger}>Overdue</GroupLabel><Card>{overdueTodos.map(t=><TodoItem key={t.id} todo={t} projects={projects} onToggle={toggleTodo} onDelete={deleteTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}}/>)}</Card></>}
        {thisWeekTodos.length>0&&<><GroupLabel>This Week</GroupLabel><Card>{thisWeekTodos.map(t=><TodoItem key={t.id} todo={t} projects={projects} onToggle={toggleTodo} onDelete={deleteTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}}/>)}</Card></>}
        {upcomingTodos.length>0&&<><GroupLabel>Upcoming</GroupLabel><Card>{upcomingTodos.map(t=><TodoItem key={t.id} todo={t} projects={projects} onToggle={toggleTodo} onDelete={deleteTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}}/>)}</Card></>}
        {undatedTodos.length>0&&<><GroupLabel>No Date</GroupLabel><Card>{undatedTodos.map(t=><TodoItem key={t.id} todo={t} projects={projects} onToggle={toggleTodo} onDelete={deleteTodo} onProjectNav={i=>{setActiveIdx(i);setView("project");}}/>)}</Card></>}
        {pendingTodos.length===0&&<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>All caught up.</p></Card>}
      </>)}
      {todoFilter==="done"&&(doneTodos.length===0?<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No completed tasks yet.</p></Card>:<Card>{[...doneTodos].reverse().map(t=><TodoItem key={t.id} todo={t} projects={projects} onToggle={toggleTodo} onDelete={deleteTodo}/>)}</Card>)}
    </Shell>
  );

  if(view==="team") return (
    <Shell>
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
            return(
              <Card key={m.id} accent={avatarBg(m.name)} style={{cursor:"pointer",marginBottom:0}}>
                <div onClick={()=>{setActiveMemberId(m.id);setView("memberView");}} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <Av name={m.name} size={30}/><div style={{minWidth:0}}><div style={{fontWeight:600,fontSize:"13px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name}</div>{m.role&&<div style={{fontSize:"11px",color:T.muted}}>{m.role}</div>}</div>
                </div>
                <div style={{fontSize:"11px",color:T.muted}}>{nc} note{nc!==1?"s":""}</div>
              </Card>
            );
          })}
        </div>}
    </Shell>
  );

  if(view==="memberView"&&activeMember) return (
    <Shell>
      <Nav/>
      <button onClick={()=>setView("team")} style={{fontSize:"12px",color:T.mid,background:"none",border:"none",cursor:"pointer",padding:"0 0 16px",fontFamily:T.sans}}>← Team</button>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,flexWrap:"wrap"}}>
        <Av name={activeMember.name} size={44}/>
        <div style={{flex:1,minWidth:0}}>
          <h1 style={{margin:0,fontFamily:T.serif,fontSize:"20px",fontWeight:700}}>{activeMember.name}</h1>
          {activeMember.role&&<p style={{margin:"2px 0 0",fontSize:"13px",color:T.mid}}>{activeMember.role}</p>}
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <Btn variant="secondary" size="sm" onClick={()=>generateMemberSummary(activeMember.id)} disabled={memberLoading}>{memberLoading?"Updating…":activeMember.summary?"↻ Refresh":"Generate"}</Btn>
          <Btn variant="danger" size="sm" onClick={()=>{deleteMember(activeMember.id);setView("team");}}>Remove</Btn>
        </div>
      </div>
      <Card accent={avatarBg(activeMember.name)}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
          <h2 style={{margin:0,fontFamily:T.serif,fontSize:"15px",fontWeight:700}}>Activity Summary</h2>
          {activeMember.summary_updated_at&&<span style={{fontSize:"11px",color:T.muted}}>{fmt(activeMember.summary_updated_at)}</span>}
        </div>
        {memberLoading?<p style={{color:T.muted,fontSize:"13px"}}>Generating…</p>
          :activeMember.summary?<MD content={activeMember.summary} small/>
          :<p style={{color:T.muted,fontSize:"13px",margin:0}}>Tag @{activeMember.name} in notes or click Generate.</p>}
      </Card>
      {(()=>{
        const mentions=[];
        for(const p of projects) for(const n of p.notes) if(n.taggedMembers?.includes(activeMember.id)||n.raw.toLowerCase().includes(activeMember.name.toLowerCase())) mentions.push({...n,projectName:p.name,projIdx:projects.findIndex(pp=>pp.name===p.name)});
        if(!mentions.length) return <Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No notes mention this person yet.</p></Card>;
        return(<>{[...mentions].reverse().map(n=>(
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

  if(view==="project"&&activeProject) return (
    <Shell>
      <Nav/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          <button onClick={()=>setView("home")} style={{fontSize:"12px",color:T.mid,background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:T.sans,flexShrink:0}}>← Overview</button>
          <div style={{width:3,height:16,background:pc(activeIdx),flexShrink:0}}/>
          <h1 style={{margin:0,fontFamily:T.serif,fontSize:"19px",fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{activeProject.name}</h1>
          <span style={{fontSize:"12px",color:T.muted,flexShrink:0}}>{activeProject.notes.length}</span>
        </div>
        <div style={{display:"flex",gap:6}}>
          <Btn size="sm" onClick={()=>{setNotePhase("input");setNotes("");setError("");setTaggedMembers([]);setTaggedSelf(false);setView("addNote");}}>+ Add Notes</Btn>
          <Btn variant="danger" size="sm" onClick={()=>deleteProject(activeIdx)}>Delete</Btn>
        </div>
      </div>
      {todos.filter(t=>t.projectId===activeProject.id&&!t.done).length>0&&(
        <Card>
          <h3 style={{margin:"0 0 8px",fontSize:"13px",fontWeight:600}}>My Open Tasks</h3>
          {todos.filter(t=>t.projectId===activeProject.id&&!t.done).map(t=><TodoItem key={t.id} todo={t} projects={projects} onToggle={toggleTodo} onDelete={deleteTodo}/>)}
        </Card>
      )}
      <Card accent={pc(activeIdx)}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
          <h2 style={{margin:0,fontFamily:T.serif,fontSize:"15px",fontWeight:700}}>Project Status</h2>
          {activeProject.status_updated_at&&<span style={{fontSize:"11px",color:T.muted}}>Updated {fmt(activeProject.status_updated_at)}</span>}
        </div>
        {activeProject.notes.length===0?<p style={{color:T.muted,fontSize:"13px",margin:0}}>Status generates after first note.</p>
          :activeProject.status?<MD content={activeProject.status} small/>
          :<p style={{color:T.muted,fontSize:"13px",margin:0}}>Status will appear after first note.</p>}
      </Card>
      <GroupLabel>Meeting Notes ({activeProject.notes.length})</GroupLabel>
      {activeProject.notes.length===0?<Card><p style={{color:T.muted,fontSize:"13px",margin:0}}>No notes yet.</p></Card>
        :[...activeProject.notes].reverse().map(n=>{
          const tagged=(n.taggedMembers||[]).map(id=>members.find(m=>m.id===id)).filter(Boolean);
          return(
            <Card key={n.id}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6,gap:6}}>
                <div style={{minWidth:0}}>
                  <span style={{fontSize:"12px",color:T.muted}}>{fmt(n.date)}</span>
                  {(tagged.length>0||n.selfTagged)&&(
                    <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>
                      {n.selfTagged&&<Tag color={T.accent}>You</Tag>}
                      {tagged.map(m=><Tag key={m.id} color={avatarBg(m.name)} onClick={()=>{setActiveMemberId(m.id);setView("memberView");}}>{m.name}</Tag>)}
                    </div>
                  )}
                </div>
                <div style={{display:"flex",gap:5,flexShrink:0}}>
                  <Btn variant="secondary" size="sm" onClick={()=>setExpandedNote(expandedNote===n.id?null:n.id)}>{expandedNote===n.id?"Hide":"View"}</Btn>
                  <Btn variant="danger" size="sm" onClick={()=>deleteNote(n.id)}>Del</Btn>
                </div>
              </div>
              {expandedNote===n.id?<div style={{borderTop:`1px solid ${T.border}`,paddingTop:10}}><MD content={n.summary} small/></div>
                :<p style={{fontSize:"12px",color:T.muted,margin:0,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{n.summary.replace(/[#*]/g,"").slice(0,110)}…</p>}
            </Card>
          );
        })}
    </Shell>
  );

  if(view==="addNote") return (
    <Shell maxW={640}>
      <Nav/>
      <button onClick={()=>{setView("project");setNotePhase("input");}} style={{fontSize:"12px",color:T.mid,background:"none",border:"none",cursor:"pointer",padding:"0 0 16px",fontFamily:T.sans}}>← {activeProject?.name}</button>
      {notePhase==="input"&&(
        <NoteTextarea
          onSubmit={analyseNote}
          onCancel={()=>{setView("project");setNotePhase("input");}}
          loading={loading}
          error={error}
          projectName={activeProject?.name}
          meName={data.me||"me"}
          members={members}
        />
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
