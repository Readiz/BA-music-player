package com.readiz.music;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebView;
import java.util.ArrayDeque;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class AndroidLoginTest {
    static class Fixture extends AndroidLogin {
        final ArrayDeque<Runnable> jobs = new ArrayDeque<>();
        String sentVerifier, sentTicket;
        int requests;
        boolean fail;
        Fixture(Activity host) { super(host, new WebView(host)); }
        @Override void execute(Runnable task) { jobs.add(task); }
        @Override void message(String text) { }
        @Override String exchange(String ticket, String verifier) throws Exception {
            requests++; sentTicket = ticket; sentVerifier = verifier;
            if (fail) throw new java.io.IOException();
            return "__Host-readiz_music_session=" + "s".repeat(43) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600; Secure";
        }
        void settle() {
            while (!jobs.isEmpty()) jobs.remove().run();
            Shadows.shadowOf(Looper.getMainLooper()).idle();
        }
    }
    Intent callback() { return new Intent(Intent.ACTION_VIEW, Uri.parse("com.readiz.music://auth?ticket=" + "t".repeat(43))); }

    @Test public void browserOwnsEntireOAuthFlowAndOnlyChallengeLeavesApp() throws Exception {
        try (var controller = Robolectric.buildActivity(Activity.class).setup()) {
            Activity host = controller.get();
            Fixture f = new Fixture(host); f.pending.edit().clear().commit();
            assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", AndroidLogin.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
            f.begin();
            Intent browser = Shadows.shadowOf(host).getNextStartedActivity();
            assertEquals(Intent.ACTION_VIEW, browser.getAction());
            assertEquals("https", browser.getData().getScheme());
            assertEquals("music.readiz.com", browser.getData().getHost());
            assertEquals("/api/auth/discord/start", browser.getData().getPath());
            String proof = f.pending.getString("verifier", "");
            assertEquals(43, proof.length());
            assertEquals(AndroidLogin.challenge(proof), browser.getData().getQueryParameter("app_challenge"));
            assertFalse(browser.getDataString().contains(proof));
            assertNull(Shadows.shadowOf(f.webView).getLastLoadedUrl());
            f.close();
            // Simulate Android destroying the app while the browser is in front.
            Fixture restarted = new Fixture(host);
            assertTrue(restarted.accept(callback()));
            assertTrue(restarted.accept(callback()));
            restarted.settle();
            assertEquals(1, restarted.requests);
            assertEquals(proof, restarted.sentVerifier);
            assertEquals("t".repeat(43), restarted.sentTicket);
            assertEquals("https://music.readiz.com/#add-music", Shadows.shadowOf(restarted.webView).getLastLoadedUrl());
            assertFalse(restarted.pending.contains("verifier"));
            assertTrue(CookieManager.getInstance().getCookie(AndroidLogin.ORIGIN).contains("__Host-readiz_music_session="));
            restarted.close();
        }
    }

    @Test public void invalidUnsolicitedOrExpiredCallbacksNeverExchange() {
        try (var controller = Robolectric.buildActivity(Activity.class).setup()) {
            Fixture f = new Fixture(controller.get()); f.pending.edit().clear().commit();
            assertTrue(f.accept(callback()));
            for (String url : new String[] { "https://music.readiz.com/?ticket=t", "com.readiz.music://auth.evil?ticket=t", "com.readiz.music://user@auth?ticket=t", "com.readiz.music://auth:44?ticket=t", "com.readiz.music://auth/other?ticket=t", "com.readiz.music://auth?ticket=t#x" }) {
                assertFalse(f.accept(new Intent(Intent.ACTION_VIEW, Uri.parse(url))));
            }
            f.begin();
            f.pending.edit().putLong("started", System.currentTimeMillis() - 13 * 60 * 1000).commit();
            assertTrue(f.accept(callback()));
            f.settle(); assertEquals(0, f.requests);
            f.close();
        }
    }

    @Test public void failureKeepsProofForRetryWithoutInjectingSession() {
        try (var controller = Robolectric.buildActivity(Activity.class).setup()) {
            Fixture f = new Fixture(controller.get());
            f.begin(); f.fail = true;
            f.accept(callback()); f.settle();
            assertTrue(f.pending.contains("verifier"));
            assertNull(Shadows.shadowOf(f.webView).getLastLoadedUrl());
            f.fail = false; f.accept(callback()); f.settle();
            assertEquals(2, f.requests);
            assertFalse(f.pending.contains("verifier"));
            f.close();
        }
    }
}
