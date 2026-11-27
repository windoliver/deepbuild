// The planted Notification Center of #3502's sixth criterion: test code, built by the suite (show.mjs) into a
// library the loader inserts into a `deep-show` run (DYLD_INSERT_LIBRARIES). In that process
// `+[UNUserNotificationCenter currentNotificationCenter]` answers this center in place of the Mac's own, and every
// call of it that asks the notification service takes 2 s to return to its caller, on whichever thread made it. The
// center delivers and holds nothing. It writes one JSON line to the file DEEP_3502_CENTER_LOG names when it is planted
// and at each call's start and end: the call's selector, whether the calling thread was the main thread, and the
// host's monotonic clock in ns.
//
// GPUI asks for the center only from an app bundle, and `deep-show` is a bare binary, so the main bundle also
// answers an identifier here. Reading the center and its `delegate` property takes no time: neither asks the
// service.
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#import <objc/runtime.h>
#import <pthread.h>
#import <stdio.h>
#import <stdlib.h>
#import <time.h>

static const NSTimeInterval kCallSeconds = 2.0;
static FILE *gLog;
static pthread_mutex_t gLock = PTHREAD_MUTEX_INITIALIZER;
static __unsafe_unretained id gDelegate;

static void note(const char *phase, SEL call) {
  if (!gLog) return;
  pthread_mutex_lock(&gLock);
  fprintf(gLog, "{\"call\":\"%s\",\"phase\":\"%s\",\"main_thread\":%s,\"ns\":%llu}\n", sel_getName(call), phase,
          pthread_main_np() ? "true" : "false", (unsigned long long)clock_gettime_nsec_np(CLOCK_UPTIME_RAW));
  fflush(gLog);
  pthread_mutex_unlock(&gLock);
}

/// One call of the notification service: 2 s on the calling thread.
static void serve(SEL call) {
  note("begin", call);
  [NSThread sleepForTimeInterval:kCallSeconds];
  note("end", call);
}

@interface DeepPlantedCenter : UNUserNotificationCenter
@end

@implementation DeepPlantedCenter
- (id<UNUserNotificationCenterDelegate>)delegate { return gDelegate; }
- (void)setDelegate:(id<UNUserNotificationCenterDelegate>)delegate { gDelegate = delegate; }
- (BOOL)supportsContentExtensions { return NO; }
- (void)requestAuthorizationWithOptions:(UNAuthorizationOptions)options completionHandler:(void (^)(BOOL granted, NSError *error))handler {
  serve(_cmd);
  if (handler) handler(YES, nil);
}
- (void)setNotificationCategories:(NSSet<UNNotificationCategory *> *)categories { serve(_cmd); }
- (void)getNotificationCategoriesWithCompletionHandler:(void (^)(NSSet<UNNotificationCategory *> *categories))handler {
  serve(_cmd);
  if (handler) handler([NSSet set]);
}
- (void)addNotificationRequest:(UNNotificationRequest *)request withCompletionHandler:(void (^)(NSError *error))handler {
  serve(_cmd);
  if (handler) handler(nil);
}
- (void)getPendingNotificationRequestsWithCompletionHandler:(void (^)(NSArray<UNNotificationRequest *> *requests))handler {
  serve(_cmd);
  if (handler) handler(@[]);
}
- (void)removePendingNotificationRequestsWithIdentifiers:(NSArray<NSString *> *)identifiers { serve(_cmd); }
- (void)removeAllPendingNotificationRequests { serve(_cmd); }
- (void)getDeliveredNotificationsWithCompletionHandler:(void (^)(NSArray<UNNotification *> *notifications))handler {
  serve(_cmd);
  if (handler) handler(@[]);
}
- (void)removeDeliveredNotificationsWithIdentifiers:(NSArray<NSString *> *)identifiers { serve(_cmd); }
- (void)removeAllDeliveredNotifications { serve(_cmd); }
@end

static id planted_center(id self, SEL _cmd) {
  static id center;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ center = class_createInstance([DeepPlantedCenter class], 0); });
  return center;
}

static NSString *(*gBundleIdentifier)(id, SEL);
static NSString *planted_identifier(id self, SEL _cmd) {
  NSString *own = gBundleIdentifier(self, _cmd);
  if (own) return own;
  return self == [NSBundle mainBundle] ? @"dev.deepbuild.acceptance-3502" : nil;
}

__attribute__((constructor)) static void plant(void) {
  const char *path = getenv("DEEP_3502_CENTER_LOG");
  if (path) gLog = fopen(path, "a");
  method_setImplementation(class_getClassMethod([UNUserNotificationCenter class], @selector(currentNotificationCenter)), (IMP)planted_center);
  Method identifier = class_getInstanceMethod([NSBundle class], @selector(bundleIdentifier));
  gBundleIdentifier = (NSString *(*)(id, SEL))method_setImplementation(identifier, (IMP)planted_identifier);
  note("planted", @selector(currentNotificationCenter));
}
