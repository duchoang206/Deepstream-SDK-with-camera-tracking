'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type Camera = {
  id: string;
  name: string;
  rtsp_url: string;
  calibration?: any;
  cam_x?: number;
  cam_y?: number;
  cam_z?: number;
  yaw?: number;
  fov_polygon?: number[][];
  status?: string;
};

interface CameraContextType {
  cameras: Camera[];
  loading: boolean;
  fetchCameras: () => Promise<void>;
  deleteCamera: (id: string) => Promise<boolean>;
  updateCamera: (id: string, name: string, rtsp_url: string) => Promise<boolean>;
}

const CameraContext = createContext<CameraContextType>({
  cameras: [],
  loading: true,
  fetchCameras: async () => {},
  deleteCamera: async () => false,
  updateCamera: async () => false
});

export function CameraProvider({ children }: { children: React.ReactNode }) {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCameras = useCallback(async () => {
    try {
      const res = await fetch('/api/backend/camera/list');
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.cameras)) {
          setCameras(data.cameras);
        }
      }
    } catch (err) {
      console.error('Error fetching cameras in CameraContext:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteCamera = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/backend/camera/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setCameras(prev => prev.filter(c => c.id !== id));
        fetchCameras();
        return true;
      }
    } catch (err) {
      console.error('Error deleting camera:', err);
    }
    return false;
  }, [fetchCameras]);

  const updateCamera = useCallback(async (id: string, name: string, rtsp_url: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/backend/camera/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, rtsp_url })
      });
      if (res.ok) {
        fetchCameras();
        return true;
      }
    } catch (err) {
      console.error('Error updating camera:', err);
    }
    return false;
  }, [fetchCameras]);

  useEffect(() => {
    fetchCameras();
    const interval = setInterval(fetchCameras, 3000);
    return () => clearInterval(interval);
  }, [fetchCameras]);

  return (
    <CameraContext.Provider value={{ cameras, loading, fetchCameras, deleteCamera, updateCamera }}>
      {children}
    </CameraContext.Provider>
  );
}

export const useCameras = () => useContext(CameraContext);
