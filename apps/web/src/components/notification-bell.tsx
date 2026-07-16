'use client';

import { useState, useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { Storydust } from '@/components/ui/storydust';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  bookId: string | null;
  bookTitle: string | null;
  coverImageUrl: string | null;
}

interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
}

// Notification copy renders client-side from the `type` field so it follows
// the parent's locale; the worker-written strings stay as the fallback for
// unknown types (and anything missing a book title).
const TYPE_TITLE_KEYS: Record<string, string> = {
  BOOK_COMPLETED: 'bookCompleted',
  BOOK_PARTIAL: 'bookPartial',
  BOOK_FAILED: 'bookFailed',
  ORDER_SHIPPED: 'orderShipped',
  ORDER_FAILED: 'orderIssue',
  ORDER_CANCELLED: 'orderIssue',
};

export function NotificationBell() {
  const t = useTranslations('notifications');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const { getToken, isSignedIn } = useAuth();

  // Localized title from the type; the stored (worker-written) title is the
  // fallback for unknown types or notifications without a book title.
  const notificationTitle = (notification: Notification): string => {
    const key = TYPE_TITLE_KEYS[notification.type];
    if (!key || !notification.bookTitle) return notification.title;
    return t(key, { title: notification.bookTitle });
  };

  const formatRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('justNow');
    if (diffMins < 60) return t('minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('daysAgo', { count: diffDays });
    return date.toLocaleDateString();
  };

  // Fetch notifications
  const fetchNotifications = async () => {
    if (!isSignedIn) return;

    try {
      const token = await getToken();
      const response = await fetch('/api/notifications', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data: NotificationsResponse = await response.json();
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial fetch and polling
  useEffect(() => {
    fetchNotifications();

    // Poll every 60 seconds
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [isSignedIn]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Mark all notifications as read when dropdown opens
  useEffect(() => {
    const markAllAsRead = async () => {
      if (!isOpen || unreadCount === 0) return;

      try {
        const token = await getToken();
        await fetch('/api/notifications/mark-all-read', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        // Clear the badge immediately
        setUnreadCount(0);
      } catch (error) {
        console.error('Failed to mark all notifications as read:', error);
      }
    };

    markAllAsRead();
  }, [isOpen]);

  // Handle notification click
  const handleNotificationClick = async (notification: Notification) => {
    try {
      const token = await getToken();
      // Mark as read
      await fetch(`/api/notifications/${notification.id}/read`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      // Update local state
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }

    // Close dropdown and navigate. Order notifications land on the orders
    // page, book notifications on the book itself; anything else keeps the
    // library.
    setIsOpen(false);
    router.push(
      notification.type.startsWith('ORDER_')
        ? '/orders'
        : notification.bookId && notification.type.startsWith('BOOK_')
          ? `/book/${notification.bookId}/preview`
          : '/library',
    );
  };

  // Don't render for signed out users
  if (!isSignedIn) return null;

  return (
    <div className="relative">
      {/* Bell Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-mint/30"
        aria-label={unreadCount > 0 ? t('bellUnread', { count: unreadCount }) : t('title')}
      >
        <Bell className="h-5 w-5 text-ink-soft" />
        {/* Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-sm bg-coral px-1 text-[11px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute top-full right-0 z-50 mt-2 w-[280px] max-w-[90vw] overflow-hidden rounded-lg border border-coral/15 bg-white shadow-lg sm:w-[320px]"
        >
          {/* Header */}
          <div className="border-b border-coral/15 px-4 py-3">
            <h3 className="font-playful font-semibold text-ink">{t('title')}</h3>
          </div>

          {/* Content */}
          <div className="max-h-[300px] overflow-y-auto">
            {isLoading ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-ink-soft">
                <Storydust variant="twinkle" size="inline" />
                <p className="font-playful text-sm">{t('justAMoment')}</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-ink-soft">
                <Bell className="mx-auto mb-2 h-8 w-8 opacity-40" />
                <p>{t('empty')}</p>
              </div>
            ) : (
              <ul>
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <button
                      onClick={() => handleNotificationClick(notification)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-coral-soft/40"
                    >
                      {/* Book thumbnail */}
                      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-cream-deep">
                        {notification.coverImageUrl ? (
                          <Image
                            src={notification.coverImageUrl}
                            alt=""
                            width={40}
                            height={40}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-ink-soft/50">
                            <span className="text-lg">📖</span>
                          </div>
                        )}
                      </div>

                      {/* Text content */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">
                          {notificationTitle(notification)}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-soft">
                          {formatRelativeTime(notification.createdAt)}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
