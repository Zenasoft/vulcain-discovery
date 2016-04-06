global
    maxconn 4096
    daemon
    #log 127.0.0.1 local0
    #log 127.0.0.1 local1 notice

defaults
  log     global
  mode    tcp
  option  dontlognull
  retries 1
  option redispatch
  maxconn 2000
  timeout connect  5000
  timeout client   5000
  timeout server   5000

  
