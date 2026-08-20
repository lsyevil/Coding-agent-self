import { useEffect, useState } from 'react';
import { apiFetch } from '../api/http';

interface AgentInfo {
  id: string;
  name: string;
  icon: string;
}

export function useAvailableAgents() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    apiFetch('/api/settings/available-agents')
      .then((res) => res.json())
      .then((data) => {
        if (!mounted) return;
        setAgents(data.agents || []);
      })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  return { agents, loading };
}
