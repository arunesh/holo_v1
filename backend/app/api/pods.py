from fastapi import APIRouter, HTTPException

from ..schemas.pod import Pod, PodSummary
from ..services import pod_store

router = APIRouter(prefix="/api", tags=["pods"])


@router.get("/pods", response_model=list[PodSummary])
def get_pods():
    return pod_store.list_pods()


@router.get("/pods/{pod_id}", response_model=Pod)
def get_pod(pod_id: str):
    try:
        return pod_store.load_pod(pod_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="pod not found")
