import { create } from 'zustand';
import { apiFetch } from '../api/http';

interface EventParticipant {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  status: 'pending' | 'accepted' | 'declined';
}

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  is_all_day: number;
  created_by: string;
  reminder_minutes: number | null;
  participants: EventParticipant[];
  created_at: string;
  updated_at: string;
}

interface EventState {
  events: CalendarEvent[];
  currentEventId: string | null;
  currentMonth: string;  // YYYY-MM
  loading: boolean;
  fetchEvents: (filter?: { startTime?: string; endTime?: string; userId?: string }) => Promise<void>;
  selectEvent: (id: string | null) => void;
  createEvent: (data: any) => Promise<{ event: CalendarEvent; conflictWarning: string | null }>;
  updateEvent: (id: string, data: Partial<CalendarEvent>) => Promise<{ conflictWarning: string | null }>;
  deleteEvent: (id: string) => Promise<void>;
  rsvp: (eventId: string, status: 'accepted' | 'declined') => Promise<void>;
  setCurrentMonth: (month: string) => void;
}

export const useEventStore = create<EventState>((set, get) => ({
  events: [],
  currentEventId: null,
  currentMonth: new Date().toISOString().slice(0, 7),
  loading: false,

  fetchEvents: async (filter) => {
    set({ loading: true });
    const params = new URLSearchParams();
    if (filter?.startTime) params.set('start', filter.startTime);
    if (filter?.endTime) params.set('end', filter.endTime);
    if (filter?.userId) params.set('userId', filter.userId);

    const res = await apiFetch(`/api/events?${params}`);
    if (res.ok) {
      const data = await res.json();
      set({ events: data.events || [], loading: false });
    } else {
      set({ loading: false });
    }
  },

  selectEvent: (id) => {
    set({ currentEventId: id });
  },

  createEvent: async (data) => {
    const res = await apiFetch('/api/events', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    const result = await res.json();
    await get().fetchEvents();
    return { event: result.event, conflictWarning: result.conflictWarning };
  },

  updateEvent: async (id, data) => {
    const res = await apiFetch(`/api/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    const result = await res.json();
    await get().fetchEvents();
    return { conflictWarning: result.conflictWarning };
  },

  deleteEvent: async (id) => {
    await apiFetch(`/api/events/${id}`, { method: 'DELETE' });
    const state = get();
    if (state.currentEventId === id) {
      set({ currentEventId: null });
    }
    await get().fetchEvents();
  },

  rsvp: async (eventId, status) => {
    await apiFetch(`/api/events/${eventId}/rsvp`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await get().fetchEvents();
  },

  setCurrentMonth: (month) => {
    set({ currentMonth: month });
  },
}));

export type { CalendarEvent, EventParticipant };
