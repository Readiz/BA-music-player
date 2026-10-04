package com.readiz.music;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Looper;
import android.webkit.WebView;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayDeque;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlertDialog;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, qualifiers = "mdpi")
@org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
public class AndroidUpdatesTest {
    static AndroidUpdates.Release release(int code) throws Exception {
        return new AndroidUpdates.Release(new JSONObject().put("packageName", "com.readiz.music")
                .put("versionCode", code).put("versionName", "0.2.14").put("size", 3)
                .put("sha256", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
    }
    static class Fixture extends AndroidUpdates {
        int checks, installs, settings;
        boolean busy, permission = true, loginRequired, offline;
        String session = "session";
        Release latest;
        final ArrayDeque<Runnable> jobs = new ArrayDeque<>();
        Fixture(Activity host) throws Exception { super(host, new WebView(host), () -> false); latest = release(20); }
        @Override String cookie() { return session; }
        @Override int installedVersion() { return 19; }
        @Override void execute(Runnable task) { jobs.add(task); }
        @Override Release fetchRelease(String cookie) throws Exception {
            checks++;
            if (loginRequired) throw new LoginRequired();
            if (offline) throw new java.io.IOException();
            return latest;
        }
        @Override void checkPlayback(PlaybackResult result) { result.accept(busy); }
        @Override File downloadRelease(Release release, String cookie) { return new File(activity.getCacheDir(), "fixture.apk"); }
        @Override boolean canInstall() { return permission; }
        @Override void openPermissionSettings() { settings++; }
        @Override void openInstaller(File file) { installs++; }
        void settle() {
            Shadows.shadowOf(Looper.getMainLooper()).idle();
            while (!jobs.isEmpty()) {
                jobs.remove().run();
                Shadows.shadowOf(Looper.getMainLooper()).idle();
            }
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(600));
        }
    }
    private AlertDialog dialog() { return ShadowAlertDialog.getLatestAlertDialog(); }

    @Test public void checksOnEveryEntryAndLaterDoesNotSetDailyCooldown() throws Exception {
        try (var controller = Robolectric.buildActivity(Activity.class).setup()) {
            Fixture f = new Fixture(controller.get());
            f.onResume(); f.settle();
            assertEquals(1, f.checks);
            assertTrue(dialog().isShowing());
            assertEquals("새 버전이 있습니다", Shadows.shadowOf(dialog()).getTitle());
            dialog().getButton(AlertDialog.BUTTON_NEGATIVE).performClick();
            f.onPause(); f.onResume(); f.settle();
            assertEquals(2, f.checks);
            assertTrue(dialog().isShowing());
            f.onPause();
            f.latest = release(19);
            f.onResume(); f.settle();
            assertEquals(3, f.checks);
            assertFalse(dialog().isShowing());
            f.latest = release(18);
            f.onPause(); f.onResume(); f.settle();
            assertEquals(4, f.checks);
            assertFalse(dialog().isShowing());
            f.close();
        }
    }

    @Test public void defersDuringPlaybackAndDropsStaleEntryResults() throws Exception {
        try (var controller = Robolectric.buildActivity(Activity.class).setup()) {
            Fixture f = new Fixture(controller.get());
            f.busy = true;
            f.onResume(); f.settle();
            assertTrue(dialog() == null || !dialog().isShowing());
            f.busy = false;
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(3));
            assertTrue(dialog().isShowing());
            f.onPause(); f.onResume(); f.onPause(); f.settle();
            assertFalse(dialog().isShowing());
            f.latest = release(19);
            f.onResume(); f.settle();
            assertFalse(dialog().isShowing());
            f.close();
        }
    }

    @Test public void loginCompletionRetriesButPageLoadsDoNotRepeatedlyPrompt() throws Exception {
        try (var controller = Robolectric.buildActivity(Activity.class).setup()) {
            Fixture f = new Fixture(controller.get());
            f.loginRequired = true; f.session = "";
            f.onResume(); f.settle();
            assertEquals(1, f.checks);
            f.onPageFinished(); f.settle();
            assertEquals(1, f.checks);
            f.loginRequired = false; f.session = "new-session";
            f.onPageFinished(); f.settle();
            assertEquals(2, f.checks);
            assertTrue(dialog().isShowing());
            dialog().getButton(AlertDialog.BUTTON_NEGATIVE).performClick();
            f.onPageFinished(); f.settle();
            assertEquals(2, f.checks);
            assertFalse(dialog().isShowing());
            f.offline = true;
            f.onPause(); f.onResume(); f.settle();
            assertFalse(dialog().isShowing());
            f.close();
        }
    }

    @Test public void permissionReturnContinuesInstallAndDenialDoesNotLoop() throws Exception {
        for (boolean grant : new boolean[] { true, false }) {
            try (var controller = Robolectric.buildActivity(Activity.class).setup()) {
                Fixture f = new Fixture(controller.get());
                f.permission = false;
                f.onResume(); f.settle();
                dialog().getButton(AlertDialog.BUTTON_POSITIVE).performClick(); f.settle();
                assertEquals("업데이트 설치 허용", Shadows.shadowOf(dialog()).getTitle());
                dialog().getButton(AlertDialog.BUTTON_POSITIVE).performClick();
                f.settle();
                assertEquals(1, f.settings);
                f.onPause(); f.permission = grant; f.onResume(); f.settle();
                assertEquals(grant ? 1 : 0, f.installs);
                assertEquals(1, f.settings);
                assertEquals(2, f.checks);
                f.close();
            }
        }
    }

    @Test public void rejectsTruncatedOversizedAndModifiedDownload() throws Exception {
        for (String bytes : new String[] { "ab", "abcd", "abd" }) {
            assertThrows(java.io.IOException.class, () -> AndroidUpdates.copyVerified(
                    new ByteArrayInputStream(bytes.getBytes(StandardCharsets.UTF_8)), new ByteArrayOutputStream(), release(20)));
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        AndroidUpdates.copyVerified(new ByteArrayInputStream("abc".getBytes(StandardCharsets.UTF_8)), output, release(20));
        assertEquals("abc", output.toString("UTF-8"));
    }

    @Test public void rendersUpdateAndPermissionPromptsAtPhoneAndTvWidths() throws Exception {
        for (int width : new int[] { 320, 600 }) {
            try (var controller = Robolectric.buildActivity(Activity.class).setup()) {
                Fixture f = new Fixture(controller.get());
                f.permission = false;
                f.onResume(); f.settle();
                capture(dialog(), width, "available");
                dialog().getButton(AlertDialog.BUTTON_POSITIVE).performClick(); f.settle();
                capture(dialog(), width, "permission");
                assertTrue(dialog().getButton(AlertDialog.BUTTON_POSITIVE).isFocusable());
                assertTrue(dialog().getButton(AlertDialog.BUTTON_NEGATIVE).isFocusable());
                f.close();
            }
        }
    }

    private void capture(AlertDialog dialog, int width, String name) throws Exception {
        android.view.View view = dialog.getWindow().getDecorView();
        view.measure(android.view.View.MeasureSpec.makeMeasureSpec(width, android.view.View.MeasureSpec.EXACTLY),
                android.view.View.MeasureSpec.makeMeasureSpec(800, android.view.View.MeasureSpec.AT_MOST));
        view.layout(0, 0, width, view.getMeasuredHeight());
        view.getViewTreeObserver().dispatchOnPreDraw();
        view.jumpDrawablesToCurrentState();
        android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(width, view.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
        view.draw(new android.graphics.Canvas(bitmap));
        File output = new File("build/reports/android-updates/" + name + "-" + width + ".png");
        output.getParentFile().mkdirs();
        try (var stream = new java.io.FileOutputStream(output)) { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream); }
        bitmap.recycle();
    }

    @Test public void installerUsesReadOnlyContentUriFromPrivateCache() throws Exception {
        try (var controller = Robolectric.buildActivity(Activity.class).setup()) {
            Activity host = controller.get();
            AndroidUpdates f = new AndroidUpdates(host, new WebView(host), () -> false);
            File directory = new File(host.getCacheDir(), "updates");
            directory.mkdirs();
            File file = new File(directory, "update.apk");
            file.createNewFile();
            f.openInstaller(file);
            Intent intent = Shadows.shadowOf(host).getNextStartedActivity();
            assertEquals(Intent.ACTION_VIEW, intent.getAction());
            assertEquals("content", intent.getData().getScheme());
            assertEquals("application/vnd.android.package-archive", intent.getType());
            assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION, intent.getFlags());
            assertThrows(IllegalArgumentException.class, () -> f.openInstaller(new File(host.getFilesDir(), "secret")));
            f.close();
        }
    }
}
