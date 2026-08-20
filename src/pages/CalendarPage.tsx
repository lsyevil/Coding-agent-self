import { useEffect } from 'react';
import { useEventStore } from '../stores/eventStore';
import { CalendarView } from '../components/Calendar/CalendarView';
import { EventDetailDrawer } from '../components/Calendar/EventDetailDrawer';

export function CalendarPage() {
  const { events, loading, fetchEvents, currentMonth, setCurrentMonth } = useEventStore();

  useEffect(() => {
    const [year, month] = currentMonth.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1).toISOString();
    const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();
    fetchEvents({ startTime: startDate, endTime: endDate });
  }, [currentMonth, fetchEvents]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CalendarView 
        events={events} 
        loading={loading}
        currentMonth={currentMonth}
        onMonthChange={setCurrentMonth}
      />
      <EventDetailDrawer />
    </div>
  );
}
