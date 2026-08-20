import { useEffect, useState } from 'react';
import { apiFetch } from '../api/http';

interface ModelInfo {
  modelId: string;
  name: string;
}

export function useAvailableModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    apiFetch('/api/settings/available-models')
      .then((res) => res.json())
      .then((data) => {
        if (!mounted) return;
        setModels(data.models || []);
      })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  return { models, loading };
}
