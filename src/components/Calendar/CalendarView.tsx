import { useState } from 'react';
import { Button, Space, Typography, Spin, theme } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { useEventStore } from '../../stores/eventStore';
import { EventCard } from './EventCard';
import { NewEventModal } from './NewEventModal';
import type { CalendarEvent } from '../../stores/eventStore';

const { Title } = Typography;

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface Props {
  events: CalendarEvent[];
  loading: boolean;
  currentMonth: string;
  onMonthChange: (month: string) => void;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

function formatMonth(year: number, month: number): string {
  return `${year}年${month}月`;
}

export function CalendarView({ events, loading, currentMonth, onMonthChange }: Props) {
  const { token } = theme.useToken();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selectEvent = useEventStore((s) => s.selectEvent);

  const [year, month] = currentMonth.split('-').map(Number);
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const prevMonth = () => {
    const newDate = new Date(year, month - 2, 1);
    onMonthChange(`${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`);
  };

  const nextMonth = () => {
    const newDate = new Date(year, month, 1);
    onMonthChange(`${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`);
  };

  const today = () => {
    const now = new Date();
    onMonthChange(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  };

  const getEventsForDate = (day: number): CalendarEvent[] => {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.filter((e) => {
      const eventDate = e.start_time.slice(0, 10);
      return eventDate === dateStr;
    });
  };

  const handleDateClick = (day: number) => {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSelectedDate(dateStr);
    setModalOpen(true);
  };

  const isToday = (day: number): boolean => {
    const now = new Date();
    return now.getFullYear() === year && now.getMonth() + 1 === month && now.getDate() === day;
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>{formatMonth(year, month)}</Title>
        <Space>
          <Button onClick={prevMonth} icon={<LeftOutlined />} />
          <Button onClick={today}>今天</Button>
          <Button onClick={nextMonth} icon={<RightOutlined />} />
        </Space>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* 星期标题 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 1 }}>
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                style={{
                  textAlign: 'center',
                  padding: '8px 0',
                  fontWeight: 600,
                  color: token.colorTextSecondary,
                  backgroundColor: token.colorFillAlter,
                }}
              >
                {day}
              </div>
            ))}
          </div>

          {/* 日历格子 */}
          <div
            style={{
              flex: 1,
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gridAutoRows: '1fr',
              gap: 1,
              backgroundColor: token.colorBorderSecondary,
            }}
          >
            {/* 空白填充 */}
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} style={{ backgroundColor: token.colorBgContainer }} />
            ))}

            {/* 日期格子 */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayEvents = getEventsForDate(day);
              const isTodayDate = isToday(day);

              return (
                <div
                  key={day}
                  onClick={() => handleDateClick(day)}
                  style={{
                    backgroundColor: token.colorBgContainer,
                    padding: 8,
                    cursor: 'pointer',
                    minHeight: 80,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div
                    style={{
                      fontWeight: isTodayDate ? 700 : 400,
                      color: isTodayDate ? token.colorPrimary : token.colorText,
                      marginBottom: 4,
                    }}
                  >
                    {day}
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    {dayEvents.slice(0, 3).map((event) => (
                      <EventCard
                        key={event.id}
                        event={event}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectEvent(event.id);
                        }}
                      />
                    ))}
                    {dayEvents.length > 3 && (
                      <div style={{ fontSize: 10, color: token.colorTextSecondary }}>
                        +{dayEvents.length - 3} 更多
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <NewEventModal open={modalOpen} onClose={() => setModalOpen(false)} defaultDate={selectedDate} />
    </div>
  );
}
