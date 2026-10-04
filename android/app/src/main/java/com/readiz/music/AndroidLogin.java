package com.readiz.music;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.widget.Toast;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** Browser OAuth plus a one-use, SHA-256 proof-bound handoff to this app's cookie jar. */
class AndroidLogin implements AutoCloseable {
    static final String ORIGIN = "https://music.readiz.com";
    private static final long PENDING_TTL = 12 * 60 * 1000;
    final Activity activity;
    final WebView webView;
    final SharedPreferences pending;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private boolean closed, exchanging;

    AndroidLogin(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        pending = activity.getSharedPreferences("android-login", Activity.MODE_PRIVATE);
    }

    static String challenge(String verifier) throws Exception {
        return Base64.encodeToString(MessageDigest.getInstance("SHA-256")
            .digest(verifier.getBytes(StandardCharsets.US_ASCII)), Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    void begin() {
        if (exchanging) return;
        try {
            byte[] random = new byte[32];
            new SecureRandom().nextBytes(random);
            String verifier = Base64.encodeToString(random, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            // Persist before switching apps: Android may kill our process while the browser is foreground.
            if (!pending.edit().putString("verifier", verifier).putLong("started", System.currentTimeMillis()).commit())
                throw new IOException("pending-write");
            Uri uri = Uri.parse(ORIGIN + "/api/auth/discord/start").buildUpon()
                .appendQueryParameter("app_challenge", challenge(verifier)).build();
            activity.startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (Exception error) {
            pending.edit().clear().apply();
            message("로그인 브라우저를 열지 못했습니다. 브라우저 설치 상태를 확인해 주세요.");
        }
    }

    boolean accept(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (!Intent.ACTION_VIEW.equals(intent == null ? null : intent.getAction()) || uri == null ||
            !"com.readiz.music".equals(uri.getScheme()) || !"auth".equals(uri.getHost()) ||
            uri.getPort() != -1 || uri.getUserInfo() != null || (uri.getPath() != null && !uri.getPath().isEmpty()) ||
            uri.getFragment() != null) return false;
        String ticket = uri.getQueryParameter("ticket");
        String verifier = pending.getString("verifier", "");
        long elapsed = System.currentTimeMillis() - pending.getLong("started", 0);
        if (ticket == null || !ticket.matches("[A-Za-z0-9_-]{43}") || !verifier.matches("[A-Za-z0-9_-]{43}") ||
            elapsed < 0 || elapsed >= PENDING_TTL) {
            message("로그인 요청이 만료됐습니다. 앱에서 다시 로그인해 주세요.");
            return true;
        }
        if (exchanging) return true;
        exchanging = true;
        message("로그인을 마무리하는 중…");
        execute(() -> {
            try {
                String cookie = exchange(ticket, verifier);
                main.post(() -> {
                    if (closed) return;
                    CookieManager.getInstance().setCookie(ORIGIN, cookie, accepted -> {
                        exchanging = false;
                        if (closed) return;
                        if (Boolean.TRUE.equals(accepted)) {
                            CookieManager.getInstance().flush();
                            pending.edit().clear().apply();
                            webView.loadUrl(ORIGIN + "/#add-music");
                        } else message("로그인을 저장하지 못했습니다. 다시 로그인해 주세요.");
                    });
                });
            } catch (Exception error) {
                // No request URLs, tickets, verifier, response bodies or cookies in Android logs.
                Log.w("ReadizMusicAuth", "handoff_failed");
                main.post(() -> {
                    if (closed) return;
                    exchanging = false;
                    message("로그인을 완료하지 못했습니다. 연결을 확인하고 다시 로그인해 주세요.");
                });
            }
        });
        return true;
    }

    void execute(Runnable task) { worker.execute(task); }
    void message(String text) { Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }

    String exchange(String ticket, String verifier) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(ORIGIN + "/api/auth/android/redeem").openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Origin", ORIGIN);
        connection.setRequestProperty("User-Agent", "ReadizMusic/" + BuildConfig.VERSION_NAME);
        String oldCookie = CookieManager.getInstance().getCookie(ORIGIN);
        if (oldCookie != null) connection.setRequestProperty("Cookie", oldCookie);
        connection.setDoOutput(true);
        byte[] body = new JSONObject().put("ticket", ticket).put("verifier", verifier)
            .toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(body.length);
        try {
            try (var output = connection.getOutputStream()) { output.write(body); }
            if (connection.getResponseCode() != 200) throw new IOException("handoff-status");
            for (var entry : connection.getHeaderFields().entrySet()) {
                if (!"Set-Cookie".equalsIgnoreCase(entry.getKey())) continue;
                for (String cookie : entry.getValue()) {
                    if (cookie.startsWith("__Host-readiz_music_session=") && cookie.contains("; Secure") && cookie.contains("; HttpOnly"))
                        return cookie;
                }
            }
            throw new IOException("handoff-cookie");
        } finally { connection.disconnect(); }
    }

    @Override public void close() {
        closed = true;
        worker.shutdownNow();
        main.removeCallbacksAndMessages(null);
    }
}
