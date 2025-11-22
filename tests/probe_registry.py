import requests

url = "https://raw.githubusercontent.com/Astral1119/formulary-registry/main/index.json"
print(f"Fetching {url}...")
resp = requests.get(url)
if resp.status_code == 200:
    print("Success!")
    try:
        data = resp.json()
        print(f"Type: {type(data)}")
        print(f"Content: {data}")
    except Exception as e:
        print(f"JSON Error: {e}")
        print(resp.text)
else:
    print(f"Failed: {resp.status_code}")
