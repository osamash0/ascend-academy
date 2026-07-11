import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listMaterials,
  getQuota,
  uploadMaterial,
  deleteMaterial,
} from '@/services/myMaterialsService';

const MATERIALS_KEY = ['my-materials'];
const QUOTA_KEY = ['my-materials-quota'];

/** In-flight statuses poll for updates; terminal ones don't. */
function hasInFlightJob(materials: { status: string }[]): boolean {
  return materials.some((m) => !['completed', 'failed', 'cancelled'].includes(m.status));
}

export function useMyMaterials() {
  const queryClient = useQueryClient();

  const materialsQuery = useQuery({
    queryKey: MATERIALS_KEY,
    queryFn: listMaterials,
    refetchInterval: (query) => (hasInFlightJob(query.state.data?.materials ?? []) ? 3000 : false),
  });

  const quotaQuery = useQuery({
    queryKey: QUOTA_KEY,
    queryFn: getQuota,
  });

  const uploadMutation = useMutation({
    mutationFn: uploadMaterial,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MATERIALS_KEY });
      void queryClient.invalidateQueries({ queryKey: QUOTA_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMaterial,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MATERIALS_KEY });
    },
  });

  return {
    materials: materialsQuery.data?.materials ?? [],
    isLoading: materialsQuery.isLoading,
    error: materialsQuery.error,
    quota: quotaQuery.data,
    upload: uploadMutation.mutateAsync,
    isUploading: uploadMutation.isPending,
    uploadError: uploadMutation.error,
    remove: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
  };
}
