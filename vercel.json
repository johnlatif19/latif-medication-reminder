{
  "version": 2,
  "builds": [
    { "src": "server.js", "use": "@vercel/node" },
    { "src": "public/**", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "/server.js" },
    { "src": "/css/(.*)", "dest": "/public/css/$1" },
    { "src": "/js/(.*)", "dest": "/public/js/$1" },
    { "src": "/login", "dest": "/public/login.html" },
    { "src": "/dashbaord", "dest": "/public/dashbaord.html" },
    { "src": "/", "dest": "/public/login.html" }
  ]
}
