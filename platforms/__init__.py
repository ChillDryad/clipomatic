# Platforms package — upload adapters for each social media platform.

from platforms.base import PlatformAdapter, get_adapter, register_adapter

# Import all adapters so their @register_adapter decorators run
from platforms import youtube  # noqa: F401
from platforms import tiktok   # noqa: F401
from platforms import instagram # noqa: F401
