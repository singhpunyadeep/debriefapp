// ─────────────────────────────────────────────────────────────
// db.js — Supabase data layer
// Drop this file into your project src/lib/db.js
// Replaces the loadData() / saveData() calls in App.jsx
//
// Install: npm install @supabase/supabase-js
// ─────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,       // from .env
  import.meta.env.VITE_SUPABASE_ANON_KEY   // from .env
);

export { supabase };

// ─────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────

export const signInWithGoogle = () =>
  supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });

export const signOut = () => supabase.auth.signOut();

export const getSession = () => supabase.auth.getSession();

export const onAuthChange = (callback) =>
  supabase.auth.onAuthStateChange((_event, session) => callback(session));

// ─────────────────────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────────────────────

export const getProfile = async (userId) => {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return data;
};

export const updateProfile = async (userId, updates) => {
  const { data } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  return data;
};

// ─────────────────────────────────────────────────────────────
// LOAD ALL DATA FOR USER
// Returns the same shape as the old loadData() so App.jsx
// needs minimal changes — just swap the call.
// ─────────────────────────────────────────────────────────────

export const loadData = async (userId) => {
  const [
    { data: projectRows },
    { data: noteRows },
    { data: memberRows },
    { data: noteMemberRows },
    { data: todoRows },
    { data: summaryRow },
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

  // Attach notes to projects, attach taggedMembers to each note
  const projects = (projectRows || []).map(p => ({
    ...p,
    statusUpdated: p.status_updated_at,
    notes: (noteRows || [])
      .filter(n => n.project_id === p.id)
      .map(n => ({
        ...n,
        selfTagged: n.self_tagged,
        taggedMembers: (noteMemberRows || [])
          .filter(nm => nm.note_id === n.id)
          .map(nm => nm.member_id),
      })),
  }));

  return {
    projects,
    members: memberRows || [],
    todos: (todoRows || []).map(t => ({
      ...t,
      dueDate: t.due_date,
      projectId: t.project_id,
      doneAt: t.done_at,
    })),
    me: profile?.name || null,
    homeWeeklySummary: summaryRow?.summary || null,
    homeWeeklySummaryDate: summaryRow?.updated_at || null,
  };
};

// ─────────────────────────────────────────────────────────────
// PROJECTS
// ─────────────────────────────────────────────────────────────

export const createProject = async (userId, name) => {
  const { data } = await supabase
    .from('projects')
    .insert({ user_id: userId, name })
    .select()
    .single();
  return { ...data, notes: [], status: null, statusUpdated: null };
};

export const updateProjectStatus = async (projectId, status) => {
  await supabase
    .from('projects')
    .update({ status, status_updated_at: new Date().toISOString() })
    .eq('id', projectId);
};

export const deleteProject = async (projectId) => {
  await supabase.from('projects').delete().eq('id', projectId);
};

// ─────────────────────────────────────────────────────────────
// NOTES
// ─────────────────────────────────────────────────────────────

export const createNote = async (userId, projectId, { raw, summary, selfTagged, taggedMemberIds }) => {
  const { data: note } = await supabase
    .from('notes')
    .insert({
      user_id: userId,
      project_id: projectId,
      raw,
      summary,
      self_tagged: selfTagged,
      date: new Date().toISOString(),
    })
    .select()
    .single();

  // Insert note_members junction rows
  if (taggedMemberIds?.length > 0) {
    await supabase.from('note_members').insert(
      taggedMemberIds.map(member_id => ({ note_id: note.id, member_id }))
    );
  }

  return {
    ...note,
    selfTagged: note.self_tagged,
    taggedMembers: taggedMemberIds || [],
  };
};

export const deleteNote = async (noteId) => {
  await supabase.from('notes').delete().eq('id', noteId);
};

// ─────────────────────────────────────────────────────────────
// MEMBERS
// ─────────────────────────────────────────────────────────────

export const createMember = async (userId, { name, role }) => {
  const { data } = await supabase
    .from('members')
    .insert({ user_id: userId, name, role })
    .select()
    .single();
  return data;
};

export const updateMemberSummary = async (memberId, summary) => {
  await supabase
    .from('members')
    .update({ summary, summary_updated_at: new Date().toISOString() })
    .eq('id', memberId);
};

export const deleteMember = async (memberId) => {
  await supabase.from('members').delete().eq('id', memberId);
};

// ─────────────────────────────────────────────────────────────
// TODOS
// ─────────────────────────────────────────────────────────────

export const createTodo = async (userId, { text, dueDate, projectId, source = 'manual' }) => {
  const { data } = await supabase
    .from('todos')
    .insert({
      user_id: userId,
      text,
      due_date: dueDate || null,
      project_id: projectId || null,
      source,
    })
    .select()
    .single();
  return { ...data, dueDate: data.due_date, projectId: data.project_id };
};

export const toggleTodo = async (todoId, done) => {
  await supabase
    .from('todos')
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq('id', todoId);
};

export const deleteTodo = async (todoId) => {
  await supabase.from('todos').delete().eq('id', todoId);
};

// ─────────────────────────────────────────────────────────────
// HOME SUMMARY
// ─────────────────────────────────────────────────────────────

export const upsertHomeSummary = async (userId, summary) => {
  await supabase
    .from('home_summaries')
    .upsert({ user_id: userId, summary, updated_at: new Date().toISOString() });
};

// ─────────────────────────────────────────────────────────────
// PROFILE NAME UPDATE (called from setup screen)
// ─────────────────────────────────────────────────────────────

export const setProfileName = async (userId, name) => {
  await supabase.from('profiles').update({ name }).eq('id', userId);
};