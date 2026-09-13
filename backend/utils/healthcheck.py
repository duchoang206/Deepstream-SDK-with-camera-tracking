"""
System Health & Diagnostics Utility
Provides runtime telemetry on GPU VRAM, CPU/RAM usage, camera stream status,
and pipeline latency monitoring for the DeepStream 4-camera tracking backend.
"""
import os
import time
import shutil
import psutil
from typing import Dict, Any, Optional

class SystemHealthDiagnostics:
    def __init__(self):
        self.start_time = time.time()
        self._latency_samples = []
        self._max_samples = 100

    def record_latency(self, latency_ms: float):
        """Record a pipeline frame processing latency sample."""
        self._latency_samples.append(latency_ms)
        if len(self._latency_samples) > self._max_samples:
            self._latency_samples.pop(0)

    def get_latency_stats(self) -> Dict[str, float]:
        """Compute average, min, max latency from recent samples."""
        if not self._latency_samples:
            return {"avg_ms": 0.0, "min_ms": 0.0, "max_ms": 0.0, "samples": 0}
        return {
            "avg_ms": round(sum(self._latency_samples) / len(self._latency_samples), 2),
            "min_ms": round(min(self._latency_samples), 2),
            "max_ms": round(max(self._latency_samples), 2),
            "samples": len(self._latency_samples)
        }

    def get_gpu_metrics(self) -> Dict[str, Any]:
        """Inspect GPU availability, model, and memory utilization."""
        gpu_info = {
            "available": False,
            "device_name": "N/A",
            "memory_used_mb": 0,
            "memory_total_mb": 0,
            "utilization_pct": 0.0
        }
        try:
            import torch
            if torch.cuda.is_available():
                gpu_info["available"] = True
                gpu_info["device_name"] = torch.cuda.get_device_name(0)
                mem_alloc = torch.cuda.memory_allocated(0) / (1024 * 1024)
                mem_total = torch.cuda.get_device_properties(0).total_memory / (1024 * 1024)
                gpu_info["memory_used_mb"] = round(mem_alloc, 1)
                gpu_info["memory_total_mb"] = round(mem_total, 1)
                gpu_info["utilization_pct"] = round((mem_alloc / mem_total) * 100.0, 1) if mem_total > 0 else 0.0
        except Exception:
            pass
        return gpu_info

    def get_system_telemetry(self, active_cameras: Optional[list] = None) -> Dict[str, Any]:
        """Aggregate full system health status report."""
        now = time.time()
        uptime_seconds = int(now - self.start_time)
        
        cpu_pct = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory()
        disk = shutil.disk_usage("/")
        
        return {
            "status": "healthy",
            "uptime_seconds": uptime_seconds,
            "timestamp": int(now * 1000),
            "cpu": {
                "usage_pct": cpu_pct,
                "cores": psutil.cpu_count(logical=True)
            },
            "memory": {
                "total_gb": round(mem.total / (1024**3), 2),
                "used_gb": round(mem.used / (1024**3), 2),
                "percent": mem.percent
            },
            "disk": {
                "total_gb": round(disk.total / (1024**3), 2),
                "free_gb": round(disk.free / (1024**3), 2),
                "used_pct": round((disk.used / disk.total) * 100.0, 1)
            },
            "gpu": self.get_gpu_metrics(),
            "pipeline": self.get_latency_stats(),
            "active_cameras_count": len(active_cameras) if active_cameras is not None else 0
        }

# Global singleton
system_diagnostics = SystemHealthDiagnostics()
