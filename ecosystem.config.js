module.exports = {
  apps: [
    {
      name: 'finvasia-trading',
      script: './build/index.js', // Use compiled JavaScript instead of ts-node
      node_args: '--max-old-space-size=2048 --optimize-for-size --gc-interval=100',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '800M', // Restart if memory exceeds 800MB
      min_uptime: '10s', // Minimum uptime before considering the app as stable
      max_restarts: 10, // Maximum number of restarts within a minute
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
