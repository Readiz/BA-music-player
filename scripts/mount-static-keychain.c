// NetAuth uses the existing login Keychain. Never accept, read or log a password.
#include <CoreFoundation/CoreFoundation.h>
#include <NetFS/NetFS.h>
#include <sys/mount.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
  if (argc != 3 || (strcmp(argv[1], "publish") && strcmp(argv[1], "serve"))) return 64;
  int readonly = strcmp(argv[1], "serve") == 0;
  // Use only the existing NAS account; the caller also verifies the account,
  // exact share and read-only flag after mounting.
  CFURLRef url = CFURLCreateWithString(NULL, readonly
    ? CFSTR("smb://readiz@192.168.0.5/readiz_static/music")
    : CFSTR("smb://readiz@192.168.0.5/readiz_static"), NULL);
  CFURLRef target = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8 *)argv[2], strlen(argv[2]), true);
  CFMutableDictionaryRef open = CFDictionaryCreateMutable(NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFMutableDictionaryRef options = CFDictionaryCreateMutable(NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFDictionarySetValue(open, kNAUIOptionKey, kNAUIOptionNoUI);
  CFDictionarySetValue(open, kNetFSForceNewSessionKey, kCFBooleanTrue);
  int flags = MNT_DONTBROWSE | MNT_NODEV | MNT_NOSUID | MNT_NOEXEC | (readonly ? MNT_RDONLY : 0);
  CFNumberRef number = CFNumberCreate(NULL, kCFNumberIntType, &flags);
  CFDictionarySetValue(options, kNetFSMountFlagsKey, number);
  CFDictionarySetValue(options, kNetFSMountAtMountDirKey, kCFBooleanTrue);
  CFDictionarySetValue(options, kNetFSAllowSubMountsKey, kCFBooleanTrue);
  CFDictionarySetValue(options, kNetFSSoftMountKey, kCFBooleanTrue);
  CFArrayRef mounts = NULL;
  int status = NetFSMountURLSync(url, target, NULL, NULL, open, options, &mounts);
  if (status) fprintf(stderr, "NAS Keychain mount unavailable (%d)\n", status);
  if (mounts) CFRelease(mounts);
  CFRelease(number); CFRelease(options); CFRelease(open); CFRelease(target); CFRelease(url);
  return status == 0 ? 0 : 1;
}
