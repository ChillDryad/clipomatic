"""
Momiji Clipper — Teams router.

Endpoints:
- POST /api/teams — Create team
- GET /api/teams — List user's teams
- GET /api/teams/{team_id} — Get team details
- POST /api/teams/{team_id}/invite — Send invite
- GET /api/teams/{team_id}/invites — List invites
- POST /api/teams/{team_id}/invites/{invite_id}/accept — Accept invite
- POST /api/teams/{team_id}/invites/{invite_id}/decline — Decline invite
- DELETE /api/teams/{team_id}/members/{user_id} — Remove member
"""

import time
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from db import User, Team, TeamMember, TeamInvite, get_session_cm
from auth import get_current_user
from utils.helpers import _user_dict
from pydantic import BaseModel

router = APIRouter(prefix="/api/teams", tags=["Teams"])


class CreateTeamRequest(BaseModel):
    name: str


class InviteToTeamRequest(BaseModel):
    email: str
    role: str = "editor"


@router.post("")
async def create_team(req: CreateTeamRequest, user: User = Depends(get_current_user)):
    """Create a new team. The creator becomes the owner."""
    async with get_session_cm() as session:
        team = Team(name=req.name, owner_id=user.id)
        session.add(team)
        await session.flush()

        member = TeamMember(team_id=team.id, user_id=user.id, role="owner")
        session.add(member)
        await session.commit()
        await session.refresh(team)

    return {
        "id": team.id,
        "name": team.name,
        "owner_id": team.owner_id,
        "created_at": team.created_at,
    }


@router.get("")
async def list_teams(user: User = Depends(get_current_user)):
    """List all teams the current user belongs to."""
    async with get_session_cm() as session:
        result = await session.execute(
            select(Team)
            .join(TeamMember)
            .where(TeamMember.user_id == user.id)
            .order_by(Team.created_at.desc())
        )
        teams = result.scalars().all()

    return [
        {"id": t.id, "name": t.name, "owner_id": t.owner_id, "created_at": t.created_at}
        for t in teams
    ]


@router.get("/{team_id}")
async def get_team(team_id: str, user: User = Depends(get_current_user)):
    """Get team details including members."""
    async with get_session_cm() as session:
        result = await session.execute(select(Team).where(Team.id == team_id))
        team = result.scalar_one_or_none()
        if not team:
            raise HTTPException(status_code=404, detail="Team not found")

        member_result = await session.execute(
            select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user.id)
        )
        member = member_result.scalar_one_or_none()
        if not member:
            raise HTTPException(status_code=403, detail="Not a member of this team")

        members_result = await session.execute(
            select(TeamMember, User).join(User, User.id == TeamMember.user_id).where(TeamMember.team_id == team_id)
        )
        members = [
            {"user_id": m.user_id, "email": u.email, "display_name": u.display_name, "role": m.role, "joined_at": m.joined_at}
            for m, u in members_result.all()
        ]

    return {"id": team.id, "name": team.name, "owner_id": team.owner_id, "members": members}


@router.post("/{team_id}/invite")
async def invite_to_team(team_id: str, req: InviteToTeamRequest, user: User = Depends(get_current_user)):
    """Send an invite to join a team."""
    async with get_session_cm() as session:
        # Check inviter is admin/owner
        inviter_result = await session.execute(
            select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user.id)
        )
        inviter = inviter_result.scalar_one_or_none()
        if not inviter or inviter.role not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="Only owner/admin can send invites")

        # Check if user already exists with this email
        result = await session.execute(select(User).where(User.email == req.email))
        existing_user = result.scalar_one_or_none()

        invite = TeamInvite(
            team_id=team_id,
            invitee_email=req.email,
            invitee_id=existing_user.id if existing_user else None,
            inviter_id=user.id,
            role=req.role,
            expires_at=time.time() + (7 * 24 * 60 * 60),  # 7 days
        )
        session.add(invite)
        await session.commit()

    return {"id": invite.id, "email": req.email, "role": req.role, "status": "pending"}


@router.get("/{team_id}/invites")
async def list_team_invites(team_id: str, user: User = Depends(get_current_user)):
    """List pending invites for a team."""
    async with get_session_cm() as session:
        member_result = await session.execute(
            select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user.id)
        )
        member = member_result.scalar_one_or_none()
        if not member or member.role not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="Only owner/admin can view invites")

        result = await session.execute(
            select(TeamInvite).where(TeamInvite.team_id == team_id, TeamInvite.status == "pending")
        )
        invites = result.scalars().all()

    return [{"id": i.id, "email": i.invitee_email, "role": i.role, "status": i.status} for i in invites]


@router.post("/{team_id}/invites/{invite_id}/accept")
async def accept_invite(team_id: str, invite_id: str, user: User = Depends(get_current_user)):
    """Accept a team invite."""
    async with get_session_cm() as session:
        invite = await session.get(TeamInvite, invite_id)
        if not invite or invite.team_id != team_id:
            raise HTTPException(status_code=404, detail="Invite not found")

        if invite.status != "pending":
            raise HTTPException(status_code=400, detail="Invite already used")

        if invite.invitee_id and invite.invitee_id != user.id:
            raise HTTPException(status_code=403, detail="Invite not for this user")

        if invite.invitee_email != user.email:
            raise HTTPException(status_code=403, detail="Email doesn't match invite")

        # Add user to team
        member = TeamMember(team_id=team_id, user_id=user.id, role=invite.role)
        session.add(member)
        invite.status = "accepted"
        await session.commit()

    return {"success": True}


@router.post("/{team_id}/invites/{invite_id}/decline")
async def decline_invite(team_id: str, invite_id: str, user: User = Depends(get_current_user)):
    """Decline a team invite."""
    async with get_session_cm() as session:
        invite = await session.get(TeamInvite, invite_id)
        if not invite or invite.team_id != team_id:
            raise HTTPException(status_code=404, detail="Invite not found")

        if invite.invitee_id and invite.invitee_id != user.id:
            raise HTTPException(status_code=403, detail="Invite not for this user")

        invite.status = "declined"
        await session.commit()

    return {"success": True}


@router.delete("/{team_id}/members/{user_id}")
async def remove_member(team_id: str, user_id: str, user: User = Depends(get_current_user)):
    """Remove a member from a team (owner/admin only)."""
    async with get_session_cm() as session:
        # Check remover is owner/admin
        remover_result = await session.execute(
            select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user.id)
        )
        remover = remover_result.scalar_one_or_none()
        if not remover or remover.role not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="Only owner/admin can remove members")

        # Cannot remove owner
        if remover.role == "owner":
            team = await session.get(Team, team_id)
            if team.owner_id == user_id:
                raise HTTPException(status_code=400, detail="Cannot remove team owner")

        # Remove member
        result = await session.execute(
            select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user_id)
        )
        member = result.scalar_one_or_none()
        if member:
            await session.delete(member)
            await session.commit()

    return {"success": True}
