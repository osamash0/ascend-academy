import React from 'react';
import { Search, Filter, Calendar } from 'lucide-react';

interface ActivityFiltersProps {
  search: string;
  setSearch: (s: string) => void;
  eventType: string;
  setEventType: (t: string) => void;
  onRefresh: () => void;
}

export function ActivityFilters({ search, setSearch, eventType, setEventType, onRefresh }: ActivityFiltersProps) {
  const eventTypes = [
    { value: '', label: 'All Events' },
    { value: 'login', label: 'Logins' },
    { value: 'lecture_complete', label: 'Lecture Complete' },
    { value: 'quiz_attempt', label: 'Quiz Attempt' },
    { value: 'slide_view', label: 'Slide View' }
  ];

  return (
    <div className="flex flex-col md:flex-row gap-4 mb-6">
      <div className="relative flex-1">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-slate-400" />
        </div>
        <input
          type="text"
          className="block w-full pl-10 pr-3 py-2 border border-white/10 rounded-lg bg-black/40 text-sm placeholder-slate-400 text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onRefresh()}
        />
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
        <Filter className="h-4 w-4 text-slate-400 shrink-0" />
        {eventTypes.map(type => (
          <button
            key={type.value || 'all'}
            onClick={() => setEventType(type.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              eventType === type.value
                ? 'bg-blue-500 text-white'
                : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/5'
            }`}
          >
            {type.label}
          </button>
        ))}
      </div>
    </div>
  );
}
