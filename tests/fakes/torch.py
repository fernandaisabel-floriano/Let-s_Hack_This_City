"""torch FALSO (numpy) — só o que classify_signs.ClipSignClassifier usa.

Só entra com PYTHONPATH=tests/fakes (tests/percurso_m4.py). Nunca em produção.
"""
from __future__ import annotations

import contextlib

import numpy as np


class T:
    def __init__(self, a):
        self.a = np.asarray(a)

    def float(self):
        return T(self.a.astype(np.float64))

    def norm(self, dim=-1, keepdim=False):
        return T(np.linalg.norm(self.a, axis=dim, keepdims=keepdim))

    def __truediv__(self, o):
        return T(self.a / (o.a if isinstance(o, T) else o))

    __itruediv__ = __truediv__

    def __mul__(self, k):
        return T(self.a * (k.a if isinstance(k, T) else k))

    __rmul__ = __mul__

    def __matmul__(self, o):
        return T(self.a @ o.a)

    @property
    def T(self):
        return T(self.a.T)

    def softmax(self, dim=-1):
        z = self.a - self.a.max(axis=dim, keepdims=True)
        e = np.exp(z)
        return T(e / e.sum(axis=dim, keepdims=True))

    def numpy(self):
        return self.a


def stack(xs):
    return T(np.stack([x.a for x in xs]))


def no_grad():
    return contextlib.nullcontext()
