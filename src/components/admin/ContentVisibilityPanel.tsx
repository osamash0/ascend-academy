import React, { useState } from 'react';
import { Search, Eye, EyeOff, Archive } from 'lucide-react';

interface ContentItem {
  id: string;
  title: string;
  is_archived: boolean;
  type: 'course' | 'lecture';
}

interface ContentVisibilityPanelProps {
  items: ContentItem[];
  onToggle: (id: string, type: 'course' | 'lecture') => Promise<void>;
}

export function ContentVisibilityPanel({ items, onToggle }: ContentVisibilityPanelProps) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'course' | 'lecture'>('all');

  const filteredItems = items.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(search.toLowerCase());
    const matchesType = filterType === 'all' || item.type === filterType;
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-white/5 p-4 rounded-xl border border-white/10">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search content..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-black/40 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>
        
        <div className="flex bg-black/40 rounded-lg p-1 border border-white/10">
          {(['all', 'course', 'lecture'] as const).map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                filterType === t ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-black/20 border border-white/5 rounded-xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 border-b border-white/5">
            <tr>
              <th className="p-4 text-slate-400 font-medium w-16">Type</th>
              <th className="p-4 text-slate-400 font-medium">Title</th>
              <th className="p-4 text-slate-400 font-medium w-32">Status</th>
              <th className="p-4 text-slate-400 font-medium w-32 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredItems.map(item => (
              <tr key={item.id} className="hover:bg-white/5 transition-colors">
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-xs font-medium uppercase tracking-wider ${
                    item.type === 'course' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                  }`}>
                    {item.type}
                  </span>
                </td>
                <td className="p-4 text-white font-medium truncate max-w-[200px] md:max-w-md">
                  {item.title}
                </td>
                <td className="p-4">
                  <span className={`flex items-center gap-1.5 text-xs font-medium ${
                    item.is_archived ? 'text-amber-400' : 'text-emerald-400'
                  }`}>
                    {item.is_archived ? <Archive className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {item.is_archived ? 'Archived' : 'Published'}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <button
                    onClick={() => onToggle(item.id, item.type)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      item.is_archived 
                        ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30' 
                        : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30'
                    }`}
                  >
                    {item.is_archived ? 'Publish' : 'Archive'}
                  </button>
                </td>
              </tr>
            ))}
            {filteredItems.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-slate-500">
                  No content matches your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
