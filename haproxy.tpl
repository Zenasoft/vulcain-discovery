global
    maxconn 4096
    daemon
    log 127.0.0.1 local0
    log 127.0.0.1 local1 notice

defaults
  log     global
  mode    tcp
  option  httplog
  option  dontlognull
  retries 3
  option redispatch
  maxconn 2000
  timeout connect  5000
  timeout client   50000
  timeout server   50000

listen stats :8081
  stats enable
  stats uri /
  stats hide-version
  stats enable
  
