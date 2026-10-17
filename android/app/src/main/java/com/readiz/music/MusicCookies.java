package com.readiz.music;

import android.net.Uri;
import android.webkit.CookieManager;
import java.util.HashMap;
import java.util.Map;

final class MusicCookies {
    static Map<String, String> headers(Uri uri, Map<String, String> original) {
        Map<String, String> headers = new HashMap<>(original);
        for (String name : new java.util.ArrayList<>(headers.keySet()))
            if ("cookie".equalsIgnoreCase(name)) headers.remove(name);
        if (!"https".equals(uri.getScheme()) || !"music.readiz.com".equals(uri.getHost())
                || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getUserInfo() != null
                || uri.getPath() == null || !(uri.getPath().startsWith("/music/")
                || uri.getPath().matches("/assets/albums/[a-z0-9-]+\\.jpg"))) return headers;
        String cookies = CookieManager.getInstance().getCookie("https://music.readiz.com/");
        if (cookies != null) for (String item : cookies.split(";")) {
            String cookie = item.trim();
            if (cookie.matches("__Host-readiz_music_session=[A-Za-z0-9_-]{32,100}")) {
                headers.put("Cookie", cookie); break;
            }
        }
        return headers;
    }
}
