"""
Vectorized ReID Cosine Similarity and L2 Normalization Engine.
"""

from typing import List, Tuple, Optional
import numpy as np


class ReIDSimilarityEngine:
    def __init__(self, threshold: float = 0.75):
        self.threshold = threshold

    @staticmethod
    def normalize_embedding(vector: np.ndarray) -> np.ndarray:
        norm = np.linalg.norm(vector)
        if norm < 1e-6:
            return vector
        return vector / norm

    def compute_similarity(self, feat1: np.ndarray, feat2: np.ndarray) -> float:
        norm_a = self.normalize_embedding(feat1)
        norm_b = self.normalize_embedding(feat2)
        sim = float(np.dot(norm_a, norm_b))
        return max(0.0, min(1.0, sim))

    def match_gallery(
        self,
        query_feat: np.ndarray,
        gallery_feats: List[np.ndarray]
    ) -> Tuple[Optional[int], float]:
        if not gallery_feats:
            return None, 0.0

        query_norm = self.normalize_embedding(query_feat)
        gallery_mat = np.array([self.normalize_embedding(f) for f in gallery_feats])
        
        sims = np.dot(gallery_mat, query_norm)
        best_idx = int(np.argmax(sims))
        best_score = float(sims[best_idx])

        if best_score >= self.threshold:
            return best_idx, best_score
        return None, best_score
