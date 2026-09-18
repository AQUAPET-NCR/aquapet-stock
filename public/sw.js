self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {
    title: 'Aquapet Stock Check',
    body: 'Time for your 11:30 AM stock check! Review your tanks and products.'
  };

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?w=192&auto=format&fit=crop&q=60',
      badge: 'https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?w=96&auto=format&fit=crop&q=60',
      vibrate: [100, 50, 100]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
