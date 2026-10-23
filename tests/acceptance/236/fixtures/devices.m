// devices: the helper a sandboxed piece spawns to reach a device (#236 AC1, AC9). For each of the camera, the
// microphone, the audio output and a screen capture it writes one JSON line to the file it is given:
//
//   {"device":"camera","sandbox":"deny"|"allow","authorized":true|false,"open":"ok"|"failed: …"|"not tried: …"}
//
// - sandbox: what the Seatbelt policy this process runs under says about that device, from sandbox_check() on
//   itself, without reporting a violation: device-camera, device-microphone, and the mach-lookup of the
//   audio server (com.apple.audio.audiohald) and of the window server (com.apple.windowserver.active), which
//   every screen capture goes through. An unsandboxed process reads "allow" for each.
// - open: a real attempt. The camera and the microphone are opened only when the OS already records
//   permission for the app this process is credited to (never a prompt); the audio output is started (it needs
//   no permission); a screen capture is taken only when the OS already allows it.
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#include <stdio.h>
#include <unistd.h>

// libsystem_sandbox, part of libSystem; returns 1 where the policy denies the operation, 0 where it allows it.
extern int sandbox_check(pid_t pid, const char *operation, int type, ...);
enum { FILTER_NONE = 0, FILTER_GLOBAL_NAME = 2, CHECK_NO_REPORT = 0x40000000 };

static FILE *out;

static void line(const char *device, int denied, int authorized, NSString *open) {
  fprintf(out, "{\"device\":\"%s\",\"sandbox\":\"%s\",\"authorized\":%s,\"open\":\"%s\"}\n", device, denied ? "deny" : "allow",
          authorized ? "true" : "false", [[open stringByReplacingOccurrencesOfString:@"\"" withString:@"'"] UTF8String]);
  fflush(out);
}

static NSString *openCapture(AVMediaType type, int *authorized) {
  AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:type];
  *authorized = status == AVAuthorizationStatusAuthorized;
  if (!*authorized) return [NSString stringWithFormat:@"not tried: authorization status %ld", (long)status];
  AVCaptureDevice *device = [AVCaptureDevice defaultDeviceWithMediaType:type];
  if (!device) return @"failed: no device";
  NSError *error = nil;
  AVCaptureDeviceInput *input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&error];
  if (!input) return [NSString stringWithFormat:@"failed: %@", error.localizedDescription ?: @"no input"];
  AVCaptureSession *session = [[AVCaptureSession alloc] init];
  if (![session canAddInput:input]) return @"failed: session refused the input";
  [session addInput:input];
  [session startRunning];
  BOOL running = session.running;
  [session stopRunning];
  return running ? @"ok" : @"failed: the session didn't run";
}

static void silence(void *data, AudioQueueRef queue, AudioQueueBufferRef buffer) {
  (void)data; (void)queue; (void)buffer;
}

static NSString *openAudioOutput(void) {
  AudioStreamBasicDescription f = { .mSampleRate = 44100, .mFormatID = kAudioFormatLinearPCM,
    .mFormatFlags = kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked, .mBytesPerPacket = 2,
    .mFramesPerPacket = 1, .mBytesPerFrame = 2, .mChannelsPerFrame = 1, .mBitsPerChannel = 16 };
  AudioQueueRef queue = NULL;
  OSStatus s = AudioQueueNewOutput(&f, silence, NULL, NULL, NULL, 0, &queue);
  if (s != noErr) return [NSString stringWithFormat:@"failed: AudioQueueNewOutput %d", (int)s];
  AudioQueueBufferRef buffer = NULL;
  s = AudioQueueAllocateBuffer(queue, 4410 * 2, &buffer);
  if (s == noErr) {
    memset(buffer->mAudioData, 0, 4410 * 2);
    buffer->mAudioDataByteSize = 4410 * 2;
    s = AudioQueueEnqueueBuffer(queue, buffer, 0, NULL);
  }
  if (s == noErr) s = AudioQueueStart(queue, NULL);
  AudioQueueStop(queue, true);
  AudioQueueDispose(queue, true);
  return s == noErr ? @"ok" : [NSString stringWithFormat:@"failed: AudioQueueStart %d", (int)s];
}

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
static NSString *openScreen(int *authorized) {
  *authorized = CGPreflightScreenCaptureAccess();
  if (!*authorized) return @"not tried: screen capture not allowed";
  CGImageRef image = CGDisplayCreateImage(CGMainDisplayID());
  if (!image) return @"failed: no image";
  CGImageRelease(image);
  return @"ok";
}
#pragma clang diagnostic pop

static int denied(const char *operation, const char *name) {
  pid_t self = getpid();
  return name ? sandbox_check(self, operation, FILTER_GLOBAL_NAME | CHECK_NO_REPORT, name) != 0
              : sandbox_check(self, operation, FILTER_NONE | CHECK_NO_REPORT) != 0;
}

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc != 2) { fprintf(stderr, "usage: devices <results file>\n"); return 2; }
    out = fopen(argv[1], "a");
    if (!out) { perror(argv[1]); return 2; }
    int authorized = 0;
    NSString *open = openCapture(AVMediaTypeVideo, &authorized);
    line("camera", denied("device-camera", NULL), authorized, open);
    open = openCapture(AVMediaTypeAudio, &authorized);
    line("microphone", denied("device-microphone", NULL), authorized, open);
    line("audio-output", denied("mach-lookup", "com.apple.audio.audiohald"), 1, openAudioOutput());
    open = openScreen(&authorized);
    line("screen-capture", denied("mach-lookup", "com.apple.windowserver.active"), authorized, open);
  }
  return 0;
}
